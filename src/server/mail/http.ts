import 'server-only';
import {z} from 'zod';
import {channelHttp} from '../channels/request.ts';
import {requirePrincipal} from '../auth/principal.ts';
import {AppError,errorResponse} from '../errors.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {requireChannelAdmin,commandHash,priorCommand,completeCommand} from '../channels/repository.ts';
import {listMailboxes,saveMailbox,mailboxRow,mailboxView} from './repository.ts';
import {verifyMailbox,disconnectMailbox} from './connections.ts';
import {startGmailAuthorization,finishGmailAuthorization} from './oauth.ts';
import {claimMailboxSync} from './sync/repository.ts';
import {runMailboxSync} from './sync/service.ts';
import {prepareMailTest,confirmMailTest} from './tests.ts';
import {diagnoseMailDomain} from './diagnostics.ts';
import {unsubscribeMail} from './unsubscribe.ts';
import {readBoundedBody} from '../channels/providers/http.ts';
import type {Principal} from '../../domain/workspace.ts';
import type {SmtpImapDeps} from './providers/smtp-imap.ts';
const actionSchema=z.strictObject({requestId:z.uuid(),expectedRevision:z.number().int().min(1)});
const limitsSchema=actionSchema.extend({limitsRevision:z.number().int().min(0),channelRevision:z.number().int().min(0),workspaceDailyLimit:z.number().int().min(1).max(100000),channelDailyLimit:z.number().int().min(1).max(100000),senderDailyLimit:z.number().int().min(1).max(100000),minIntervalSeconds:z.number().int().min(1).max(86400),maxIntervalSeconds:z.number().int().min(1).max(86400)}).refine(b=>b.maxIntervalSeconds>=b.minIntervalSeconds);
async function detail(p:Principal,id:string){return withWorkspaceTransaction(p,async c=>{await requireChannelAdmin(c);const row=await mailboxRow(c,id),sender=(await c.query("SELECT * FROM app.channel_sender WHERE connection_id=$1 AND channel='EMAIL' ORDER BY id LIMIT 1",[id])).rows[0];
 const limits=(await c.query('SELECT * FROM app.messaging_limits')).rows[0],channelLimits=(await c.query("SELECT * FROM app.messaging_channel_limits WHERE channel='EMAIL'")).rows[0];
 return {mailbox:await mailboxView(c,row),config:row.identifiers.config,senderRevision:Number(sender?.revision??0),limits:{revision:Number(limits?.revision??0),workspaceDailyLimit:limits?.workspace_daily_limit??null,timezone:limits?.timezone??'America/Sao_Paulo'},channelLimits:channelLimits?{revision:Number(channelLimits.revision),dailyLimit:channelLimits.daily_limit,minIntervalSeconds:channelLimits.min_interval_seconds,maxIntervalSeconds:channelLimits.max_interval_seconds}:null,bouncePaused:row.bounce_paused,syncGap:row.sync_gap};});}
export function mailboxHttp(request:Request,params:Record<string,string>,deps:{transport?:SmtpImapDeps}={}):Promise<Response>{return channelHttp(request,async(p,body)=>{
 const {id,action}=params;
 if(!id){if(request.method==='GET')return listMailboxes(p);if(request.method==='POST')return saveMailbox(p,body);}
 if(request.method==='GET'){if(!action||action==='status')return detail(p,id);if(action==='diagnostics')return diagnoseMailDomain(p,id,new URL(request.url).searchParams.get('selector')??undefined);}
 if(request.method!=='POST')throw new AppError(405,'Método não permitido.');
 if(action==='test-prepare')return prepareMailTest(p,id,body);if(action==='test-confirm')return confirmMailTest(p,id,body);
 if(action==='disconnect')return disconnectMailbox(p,{...(body as Record<string,unknown>),id});
 if(action==='limits'){
  const parsed=limitsSchema.safeParse(body);if(!parsed.success)throw new AppError(422,'Revise os limites e os intervalos de envio.');const b=parsed.data;
  return withWorkspaceTransaction(p,async c=>{await requireChannelAdmin(c);await lockWorkspace(c);const hash=commandHash({action:'mail.limits',id,b}),old=await priorCommand(c,p,b.requestId,hash);if(old)return old;
   const box=await mailboxRow(c,id),sender=(await c.query("SELECT * FROM app.channel_sender WHERE connection_id=$1 AND channel='EMAIL' FOR UPDATE",[id])).rows[0],global=(await c.query('SELECT * FROM app.messaging_limits FOR UPDATE')).rows[0],channel=(await c.query("SELECT * FROM app.messaging_channel_limits WHERE channel='EMAIL' FOR UPDATE")).rows[0];
   if(!sender)throw new AppError(409,'Verifique a caixa antes de salvar limites.');if(Number(box.revision)!==b.expectedRevision||Number(global?.revision??0)!==b.limitsRevision||Number(channel?.revision??0)!==b.channelRevision)throw new AppError(409,'Os limites mudaram. Revise novamente.');
   await c.query('INSERT INTO app.messaging_limits(workspace_id,workspace_daily_limit,revision) VALUES($1,$2,1) ON CONFLICT(workspace_id) DO UPDATE SET workspace_daily_limit=EXCLUDED.workspace_daily_limit,revision=messaging_limits.revision+1',[p.workspaceId,b.workspaceDailyLimit]);
   await c.query("INSERT INTO app.messaging_channel_limits(workspace_id,channel,daily_limit,min_interval_seconds,max_interval_seconds) VALUES($1,'EMAIL',$2,$3,$4) ON CONFLICT(workspace_id,channel) DO UPDATE SET daily_limit=EXCLUDED.daily_limit,min_interval_seconds=EXCLUDED.min_interval_seconds,max_interval_seconds=EXCLUDED.max_interval_seconds,revision=messaging_channel_limits.revision+1",[p.workspaceId,b.channelDailyLimit,b.minIntervalSeconds,b.maxIntervalSeconds]);
   await c.query('UPDATE app.channel_sender SET daily_limit=$2,revision=revision+1 WHERE id=$1',[sender.id,b.senderDailyLimit]);const result={saved:true};await completeCommand(c,p,b.requestId,hash,result,'mail.limits');return result;
  });
 }
 if(action==='resume'){
  const parsed=actionSchema.extend({acknowledge:z.literal(true),reason:z.string().trim().min(20).max(2000)}).safeParse(body);if(!parsed.success)throw new AppError(422,'Confirme a revisão do histórico e descreva o motivo para retomar.');
  const b=parsed.data;return withWorkspaceTransaction(p,async c=>{await requireChannelAdmin(c);await lockWorkspace(c);const hash=commandHash({action:'mail.resume',id,b}),old=await priorCommand(c,p,b.requestId,hash);if(old)return old;await mailboxRow(c,id);await c.query('SELECT app.resume_mailbox($1,$2,$3)',[id,b.expectedRevision,b.reason]);await completeCommand(c,p,b.requestId,hash,{reviewed:true},'mail.resume');return {reviewed:true};});
 }
 if(!['authorize','verify','sync'].includes(action))throw new AppError(404,'Ação não encontrada.');
 const parsed=actionSchema.safeParse(body);if(!parsed.success)throw new AppError(422,'Revise a caixa antes de continuar.');const b=parsed.data,hash=commandHash({action:'mail.'+action,id,b});
 const old=await withWorkspaceTransaction(p,async c=>{await requireChannelAdmin(c);const row=await mailboxRow(c,id);if(Number(row.revision)!==b.expectedRevision)throw new AppError(409,'A caixa mudou.');return priorCommand(c,p,b.requestId,hash);});if(old)return old;
 let result:unknown;
 if(action==='authorize')result=await startGmailAuthorization(p,p.sessionId,{id,expectedRevision:b.expectedRevision});
 else if(action==='verify')result=await verifyMailbox(p,id,b.expectedRevision,deps.transport);
 else{const leases=await claimMailboxSync(new Date().toISOString(),{workspaceId:p.workspaceId,mailboxId:id,limit:1});if(leases[0])await runMailboxSync(leases[0],deps.transport);result=await detail(p,id);}
 return withWorkspaceTransaction(p,async c=>{await requireChannelAdmin(c);await lockWorkspace(c);const prior=await priorCommand(c,p,b.requestId,hash);if(prior)return prior;await completeCommand(c,p,b.requestId,hash,result,'mail.'+action);return result;});
});}
export async function gmailCallbackHttp(request:Request):Promise<Response>{
 const destination=new URL('/settings/email',process.env.BETTER_AUTH_URL??'http://127.0.0.1:3210');
 try{if(request.method!=='GET')throw new AppError(405,'Método não permitido.');const p=await requirePrincipal(request.headers);await finishGmailAuthorization(p,p.sessionId,new URL(request.url));destination.searchParams.set('oauth','connected');}
 catch{destination.searchParams.set('oauth','failed');}
 return new Response(null,{status:303,headers:{location:destination.toString(),'cache-control':'no-store','referrer-policy':'no-referrer'}});
}
const postCounts=new Map<string,{at:number;count:number}>();
export async function mailUnsubscribeHttp(request:Request,token:string,mode:'browser'|'one-click'):Promise<Response>{
 try{
  const headers={'cache-control':'no-store','referrer-policy':'no-referrer'};
  if(request.method==='GET'&&mode==='browser')return Response.json({confirmationRequired:true},{headers});
  if(request.method!=='POST')throw new AppError(405,'Método não permitido.');
  if(mode==='browser'){
   const origins=[new URL(process.env.BETTER_AUTH_URL??'http://127.0.0.1:3210').origin];
   try{const publicUrl=new URL(process.env.MAIL_PUBLIC_BASE_URL??'');if(publicUrl.protocol==='https:'&&!publicUrl.username&&!publicUrl.password&&publicUrl.pathname==='/'&&!publicUrl.search&&!publicUrl.hash)origins.push(publicUrl.origin);}catch{}
   if(!origins.includes(request.headers.get('origin')??''))throw new AppError(403,'Origem não permitida.');
  }
  let bytes:Uint8Array;try{bytes=await readBoundedBody(new Response(request.body),1024);}catch{throw new AppError(413,'Formulário muito grande.');}
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);let input:unknown;
  if(mode==='one-click'){
   if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/x-www-form-urlencoded')throw new AppError(422,'Formulário inválido.');
   const form=new URLSearchParams(text);if([...form].length!==1||form.get('List-Unsubscribe')!=='One-Click')throw new AppError(422,'Formulário inválido.');input='List-Unsubscribe=One-Click';
  }else try{input=JSON.parse(text);}catch{throw new AppError(422,'Confirme o descadastro.');}
  const key=token.slice(0,100),now=Date.now(),prior=postCounts.get(key),count=prior&&now-prior.at<60000?prior.count+1:1;
  if(postCounts.size>=1000&&!postCounts.has(key))postCounts.delete(postCounts.keys().next().value!);
  postCounts.set(key,{at:prior&&now-prior.at<60000?prior.at:now,count});
  if(count>30)throw new AppError(429,'Tente novamente em um minuto.');
  await unsubscribeMail(token,mode,input);return Response.json({message:'Solicitação recebida.'},{headers});
 }catch(error){return errorResponse(error);}
}
