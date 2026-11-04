import 'server-only';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import {linkedinActionAllowed} from '../../domain/linkedin-capabilities.ts';
import {confirmReplySchema,replyInputSchema,type LinkedinMessageView} from '../../domain/linkedin-message-action.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {workerPool} from '../prospecting/worker-db.ts';
import {linkedinCapabilityView} from './capabilities.ts';
import {capsVersion} from './connections.ts';
import {linkedinSqlError} from './people.ts';
import {unipileRequest,unipileSettings,UnipileMissing,UnipileRetry,type UnipileDeps} from './unipile.ts';
// 07A.3a: conversations with campaign people. Replies are reviewed text confirmed by the same person within a minute.
const failures:Record<string,[number,string]>={
 LINKEDIN_CAMPAIGN_ACCESS:[403,'Somente proprietário, administrador ou operador responde no LinkedIn.'],
 LINKEDIN_THREAD_NOT_FOUND:[404,'Conversa não encontrada.'],
 LINKEDIN_OPTED_OUT:[409,'Esta pessoa pediu para não ser contatada. Nada foi enviado.'],
 LINKEDIN_ACCOUNT_NOT_READY:[409,'A conta LinkedIn desta conversa não está pronta. Nada foi enviado.'],
 LINKEDIN_REPLY_INVALID:[409,'Esta revisão não pertence a você ou a esta conversa. Revise de novo.'],
 LINKEDIN_REPLY_USED:[409,'Esta revisão já foi usada. Revise de novo para enviar outra mensagem.'],
 LINKEDIN_REPLY_EXPIRED:[409,'A revisão venceu: o envio precisa acontecer até um minuto depois. Revise de novo.'],
 LINKEDIN_REPLY_CHANGED:[409,'O texto mudou depois da revisão. Revise de novo antes de enviar.'],
};
const sqlError=linkedinSqlError(failures);
const tx=<T,>(p:Principal,fn:(c:PoolClient)=>Promise<T>)=>withWorkspaceTransaction(p,fn).catch(e=>{throw sqlError(e);});
const digest=(t:string)=>createHash('sha256').update(t).digest('hex');
async function sendGate(c:PoolClient){
 const cap=await linkedinCapabilityView(c);
 if(!linkedinActionAllowed(cap.capabilities,'sendMessage'))throw new AppError(409,cap.reason||'O fornecedor habilitado não oferece o envio de mensagens.','LINKEDIN_UNAVAILABLE');
 // A missing key fails here, before any claim: nothing left, so nothing is uncertain.
 unipileSettings();
 return capsVersion(cap);
}
export async function getLinkedinThread(p:Principal,threadId:string):Promise<{thread:{id:string;personId:string;name:string;optedOut:boolean};messages:LinkedinMessageView[]}>{
 if(!z.uuid().safeParse(threadId).success)throw new AppError(...failures.LINKEDIN_THREAD_NOT_FOUND,'LINKEDIN_THREAD_NOT_FOUND');
 return tx(p,async c=>{
  await c.query('SELECT app.linkedin_campaign_actor(false)');
  const t=(await c.query(`SELECT t.id,p.id person_id,p.name,p.opted_out_at FROM app.linkedin_thread t JOIN app.linkedin_campaign_person p ON p.workspace_id=t.workspace_id AND p.id=t.person_id WHERE t.id=$1`,[threadId])).rows[0];
  if(!t)throw new AppError(...failures.LINKEDIN_THREAD_NOT_FOUND,'LINKEDIN_THREAD_NOT_FOUND');
  const m=(await c.query('SELECT id,direction,body,sent_at FROM app.linkedin_message WHERE thread_id=$1 ORDER BY sent_at,id LIMIT 500',[threadId])).rows;
  return {thread:{id:t.id,personId:t.person_id,name:t.name,optedOut:!!t.opted_out_at},messages:m.map(r=>({id:r.id,direction:r.direction,body:r.body,sentAt:r.sent_at.toISOString()}))};
 });
}
/** The review: a one-minute token bound to this user, this conversation and this exact text. */
export async function prepareLinkedinReply(p:Principal,raw:unknown):Promise<{token:string;expiresAt:string;body:string}>{
 const parsed=replyInputSchema.safeParse(raw);if(!parsed.success)throw new AppError(422,'Escreva a mensagem (até 8.000 caracteres).');
 const {threadId,body}=parsed.data,token=randomBytes(32).toString('base64url');
 return tx(p,async c=>{await sendGate(c);
  const at=(await c.query('SELECT app.prepare_linkedin_reply($1,$2,$3,$4) v',[randomUUID(),threadId,digest(body),digest(token)])).rows[0].v as Date;
  return {token,expiresAt:new Date(at).toISOString(),body};});
}
/** The human action: sends at most once per request; an uncertain send is never repeated. */
export async function confirmLinkedinReply(p:Principal,raw:unknown,deps:UnipileDeps={}):Promise<{state:'sent'|'uncertain'|'failed'}>{
 const parsed=confirmReplySchema.safeParse(raw);if(!parsed.success)throw new AppError(422,'Confirmação inválida.');const i=parsed.data;
 const claim=await tx(p,async c=>{const version=await sendGate(c);
  const r=(await c.query('SELECT app.claim_linkedin_reply($1,$2,$3,$4) v',[i.threadId,digest(i.token),digest(i.body),i.requestId])).rows[0].v as {replay:boolean;state?:string;replyId:string;chat:string;external:string;capabilitiesVersion:string};
  if(!r.replay&&r.capabilitiesVersion!==version)throw new AppError(409,'A conta LinkedIn precisa ser verificada de novo. Nada foi enviado.','LINKEDIN_ACCOUNT_NOT_READY');
  return r;});
 if(claim.replay)return {state:(claim.state==='sending'?'uncertain':claim.state) as 'sent'|'uncertain'|'failed'};
 let outcome:'sent'|'uncertain'|'failed',remote:string|null=null,error:string|null=null;
 try{
  const form=new FormData();form.set('text',i.body);
  const r=await unipileRequest('POST',`/api/v1/chats/${encodeURIComponent(claim.chat)}/messages`,form,deps);
  outcome='sent';remote=typeof r?.message_id==='string'?r.message_id.slice(0,200):null;
 }catch(e){
  const status=e instanceof UnipileRetry?e.status:e instanceof UnipileMissing?404:undefined;
  // No status or a 5xx: the message may have left. Never resend.
  if(status===undefined||status>=500){outcome='uncertain';error='Sem confirmação do LinkedIn; a mensagem não será reenviada.';}
  else{outcome='failed';error=`O LinkedIn recusou a mensagem (${status}).`;}
 }
 await tx(p,c=>c.query('SELECT app.finish_linkedin_reply($1,$2,$3,$4,$5)',[claim.replyId,outcome,remote,i.body,error]));
 if(outcome==='failed')throw new AppError(422,error!,'LINKEDIN_REPLY_FAILED');
 return {state:outcome};
}
/** Worker: new messages of accounts with campaign people, newest first, up to `limit` pages of 100. */
export async function runLinkedinMessageTick(o:{limit:number;now?:Date;signal?:AbortSignal},deps:UnipileDeps={}){
 const pool=workerPool(),token=randomUUID(),now=o.now??new Date();
 const c0=await pool.connect();let version:string|null;
 try{const v=await linkedinCapabilityView(c0);version=linkedinActionAllowed(v.capabilities,'readMessages')?capsVersion(v):null;}finally{c0.release();}
 if(!version)return {accounts:0,stored:0};
 const accounts=(await pool.query('SELECT app.claim_linkedin_messages($1,$2,$3) v',[now,o.limit,token])).rows[0].v as {workspaceId:string;accountId:string;external:string;memberId:string;after:string;capabilitiesVersion:string}[];
 let stored=0;
 for(const a of accounts){
  if(o.signal?.aborted)break;
  const items:Record<string,unknown>[]=[];let newest=Date.parse(a.after),ok=a.capabilitiesVersion===version;
  // One hour of overlap: ids make the repeat harmless, a gap would lose messages.
  const after=new Date(Date.parse(a.after)-3600e3).toISOString();
  try{
   let cursor:string|null=null;
   for(let page=0;ok&&page<3;page++){
    const r=await unipileRequest('GET','/api/v1/messages?'+new URLSearchParams({account_id:a.external,after,limit:'100',...(cursor?{cursor}:{})}),undefined,deps);
    for(const m of Array.isArray(r?.items)?r.items:[]){
     if(typeof m?.id!=='string'||typeof m?.chat_id!=='string')continue;
     const ts=Date.parse(m.timestamp);if(!Number.isFinite(ts))continue;newest=Math.max(newest,ts);
     items.push({chat:m.chat_id.slice(0,200),remoteId:String(m.provider_id??m.id).slice(0,200),direction:m.is_sender===1||m.is_sender===true?'out':'in',body:String(m.text??'').slice(0,8000),sentAt:new Date(ts).toISOString()});
    }
    cursor=typeof r?.cursor==='string'&&r.cursor?r.cursor:null;if(!cursor)break;
   }
   // Resolve each unknown chat once; its attendee decides whether it is a campaign conversation.
   const chats=[...new Set(items.map(x=>x.chat as string))];
   const known=new Set<string>((await pool.query('SELECT app.linkedin_known_chats($1,$2,$3) v',[a.workspaceId,a.memberId,chats])).rows[0].v);
   const attendee=new Map<string,string|null>();
   for(const chat of chats.filter(x=>!known.has(x))){
    try{const r=await unipileRequest('GET',`/api/v1/chats/${encodeURIComponent(chat)}`,undefined,deps);attendee.set(chat,typeof r?.attendee_provider_id==='string'?r.attendee_provider_id:null);}
    catch(e){if(!(e instanceof UnipileMissing))throw e;attendee.set(chat,null);}
   }
   for(const it of items)it.attendee=known.has(it.chat as string)?null:attendee.get(it.chat as string)??'';
  }catch{ok=false;}
  stored+=(await pool.query('SELECT app.finish_linkedin_messages($1,$2,$3,$4,$5) v',[a.workspaceId,a.accountId,token,JSON.stringify(ok?items:[]),ok?new Date(newest).toISOString():a.after])).rows[0].v;
 }
 return {accounts:accounts.length,stored};
}
