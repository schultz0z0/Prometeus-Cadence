import 'server-only';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {Reviewed} from '../../domain/reviewed-operation.ts';
import {MAX_DESTINATIONS,webhookInputSchema,type DeliveryView,type WebhookInput,type WebhookView} from '../../domain/integration-delivery.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {encryptCredential} from '../channels/crypto.ts';
import {createReviewToken,hashValue,verifyReviewToken} from '../prospecting/review.ts';
import {approvePublicUrl,resolvePublicDns,type ResolveDns} from '../prospecting/extraction/public-url.ts';
const secret=()=>{if(!process.env.BETTER_AUTH_SECRET)throw Error('Review signing unavailable');return process.env.BETTER_AUTH_SECRET;};
const failures:Record<string,[number,string]>={
 WEBHOOK_ACCESS:[403,'Somente proprietário ou administrador gerencia webhooks.'],
 WEBHOOK_NOT_FOUND:[404,'Webhook não encontrado.'],
 WEBHOOK_CONFLICT:[409,'O webhook mudou em outra aba. Recarregue antes de salvar.'],
 WEBHOOK_LIMIT:[409,`O limite é de ${MAX_DESTINATIONS} webhooks por workspace.`],
 WEBHOOK_INACTIVE:[409,'Ative o webhook antes de testar.'],
 WEBHOOK_INVALID:[422,'Operação inválida.'],
};
export function webhookError(e:unknown){const k=e instanceof Error?failures[e.message]:undefined;return k?new AppError(k[0],k[1],e instanceof Error?e.message:undefined):e;}
type Row={id:string;name:string;url:string;events:string[];list_ids:string[]|null;active:boolean;attention:string|null;secret:unknown;secret_revision:number;revision:string|number;consecutive_failures:number;last_success_at:Date|null;deliveries?:number};
const view=(r:Row):WebhookView=>({id:r.id,name:r.name,url:r.url,events:r.events as WebhookView['events'],listIds:r.list_ids,active:r.active,state:r.attention?'attention':'ok',attention:r.attention,secretConfigured:!!r.secret,revision:Number(r.revision),consecutiveFailures:r.consecutive_failures,lastSuccessAt:r.last_success_at?.toISOString()??null,deliveries:Number(r.deliveries??0)});
async function admin(c:PoolClient){const role=(await c.query('SELECT app.current_role() AS role')).rows[0].role;if(!['owner','admin'].includes(role))throw new AppError(403,failures.WEBHOOK_ACCESS[1],'WEBHOOK_ACCESS');}
const seal=(p:Principal,id:string,revision:number,value:string)=>encryptCredential({secret:value},{workspaceId:p.workspaceId,connectionId:id,provider:'webhook',revision});
export async function listWebhooks(p:Principal):Promise<WebhookView[]>{
 return withWorkspaceTransaction(p,async c=>{await admin(c);
  return(await c.query('SELECT w.*,(SELECT count(*)::int FROM app.integration_delivery d WHERE d.workspace_id=w.workspace_id AND d.destination_id=w.id) deliveries FROM app.webhook_destination w ORDER BY w.created_at,w.id')).rows.map(view);});
}
export async function listDeliveries(p:Principal,id:string):Promise<DeliveryView[]>{
 return withWorkspaceTransaction(p,async c=>{await admin(c);
  if(!(await c.query('SELECT 1 FROM app.webhook_destination WHERE id=$1',[id])).rowCount)throw new AppError(404,'Webhook não encontrado.');
  return(await c.query('SELECT d.*,e.type FROM app.integration_delivery d JOIN app.integration_event e ON e.workspace_id=d.workspace_id AND e.id=d.event_id WHERE d.destination_id=$1 ORDER BY d.created_at DESC,d.id LIMIT 20',[id])).rows
   .map(r=>({id:r.id,eventType:r.type,state:r.state,attempts:r.attempts,lastStatus:r.last_status,lastError:r.last_error,createdAt:r.created_at.toISOString(),deliveredAt:r.delivered_at?.toISOString()??null,nextAt:r.state==='pending'?r.next_at.toISOString():null}));});
}
// The review never carries the pasted secret; it binds a digest of it.
const reviewInput=(input:WebhookInput)=>{const {secret:s,...rest}=input;return{...rest,secretDigest:s?hashValue(s):null};};
const proof=(p:Principal,id:string|null,input:WebhookInput)=>({purpose:'webhook.save',userId:p.userId,workspaceId:p.workspaceId,id,input:reviewInput(input)});
async function blockers(c:PoolClient,id:string|null,input:WebhookInput,resolve:ResolveDns){
 const out:string[]=[];
 try{await approvePublicUrl(input.url,resolve);}catch{out.push('Use um endereço público em HTTPS ou HTTP, nas portas 80 ou 443. Endereços internos, locais ou privados não recebem webhooks.');}
 if(input.lists.mode==='specific'){const found=Number((await c.query('SELECT count(*) n FROM app.list WHERE id=ANY($1::text[])',[input.lists.ids])).rows[0].n);if(found!==new Set(input.lists.ids).size)out.push('Alguma lista escolhida não existe mais.');}
 if(!id&&Number((await c.query('SELECT count(*) n FROM app.webhook_destination')).rows[0].n)>=MAX_DESTINATIONS)out.push(failures.WEBHOOK_LIMIT[1]);
 return out;
}
const idSchema=z.uuid().nullable(),parseInput=(raw:unknown)=>{const r=webhookInputSchema.safeParse(raw);if(!r.success)throw new AppError(422,'Revise o nome, a URL, os eventos e as listas.');return r.data;};
export async function prepareWebhook(p:Principal,raw:{id?:string|null;input:unknown},deps:{resolve?:ResolveDns}={}):Promise<Reviewed<Omit<WebhookInput,'secret'>&{secretProvided:boolean}>>{
 const input=parseInput(raw.input),id=raw.id??null;if(!idSchema.safeParse(id).success)throw new AppError(404,'Webhook não encontrado.');
 return withWorkspaceTransaction(p,async c=>{await admin(c);
  const b=await blockers(c,id,input,deps.resolve??resolvePublicDns),{secret:s,...shown}=input,pr=proof(p,id,input);
  return{input:{...shown,secretProvided:!!s},token:createReviewToken(pr,secret()),expiresAt:new Date(Date.now()+600000).toISOString(),basisHash:hashValue(pr),blockers:b,
   warnings:['A entrega é pelo menos uma vez: o mesmo evento pode chegar mais de uma vez. Use o idempotencyKey para ignorar repetições.']};
 });
}
export async function confirmWebhook(p:Principal,raw:{id?:string|null;input:unknown;token:unknown;requestId:unknown},deps:{resolve?:ResolveDns}={}):Promise<WebhookView>{
 const input=parseInput(raw.input),id=raw.id??null,requestId=z.uuid().safeParse(raw.requestId);
 if(!idSchema.safeParse(id).success||!requestId.success||typeof raw.token!=='string')throw new AppError(422,'Revise o webhook antes de salvar.');
 verifyReviewToken(raw.token,proof(p,id,input),secret());
 const target=id??requestId.data;
 try{return await withWorkspaceTransaction(p,async c=>{await admin(c);
  // Same request id on a create returns the destination it already created (double click, retried response).
  if(!id){const prior=(await c.query('SELECT * FROM app.webhook_destination WHERE id=$1',[target])).rows[0];if(prior){if(prior.url!==input.url||prior.name!==input.name)throw new AppError(409,'Este pedido já foi usado com outros dados.');return view(prior);}}
  const b=await blockers(c,id,input,deps.resolve??resolvePublicDns);if(b.length)throw new AppError(409,b[0],'WEBHOOK_BLOCKED');
  const current=id?(await c.query('SELECT secret_revision FROM app.webhook_destination WHERE id=$1',[id])).rows[0]:null;
  if(id&&!current)throw new AppError(404,'Webhook não encontrado.');
  const sealed=input.secret?seal(p,target,(current?.secret_revision??0)+1,input.secret):null;
  return view((await c.query('SELECT * FROM app.save_webhook($1,$2,$3,$4,$5,$6,$7,$8)',[target,!id,input.expectedRevision,input.name,input.url,input.events,input.lists.mode==='all'?null:[...new Set(input.lists.ids)],sealed])).rows[0]);
 });}catch(e){throw webhookError(e);}
}
const actionSchema=z.strictObject({action:z.enum(['pause','activate','delete','retry','test','secret']),expectedRevision:z.number().int().min(0)});
// A generated secret is returned exactly once; later reads only say that one is configured.
export async function webhookAction(p:Principal,id:string,raw:unknown):Promise<{webhook:WebhookView|null;secret?:string;eventId?:string}>{
 const parsed=actionSchema.safeParse(raw);if(!parsed.success||!z.uuid().safeParse(id).success)throw new AppError(422,'Operação inválida.');const {action,expectedRevision}=parsed.data;
 try{return await withWorkspaceTransaction(p,async c=>{await admin(c);
  if(action==='test'){const eventId=(await c.query('SELECT app.webhook_test($1) v',[id])).rows[0].v as string;return{webhook:null,eventId};}
  let generated:string|undefined,sealed=null;
  if(action==='secret'){const row=(await c.query('SELECT secret_revision FROM app.webhook_destination WHERE id=$1',[id])).rows[0];if(!row)throw new AppError(404,'Webhook não encontrado.');generated=randomBytes(32).toString('base64url');sealed=seal(p,id,row.secret_revision+1,generated);}
  const r=(await c.query('SELECT * FROM app.webhook_action($1,$2,$3,$4)',[id,expectedRevision,action,sealed])).rows[0] as Row;
  return{webhook:action==='delete'?null:view(r),...(generated?{secret:generated}:{})};
 });}catch(e){throw webhookError(e);}
}
