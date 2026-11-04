import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Pool} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import {inviteWindowOpen} from '../../domain/linkedin-campaign.ts';
import {renderLinkedinText,sequenceDraftSchema,sequenceMode,type LinkedinSequenceView} from '../../domain/linkedin-sequence.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {workerPool} from '../prospecting/worker-db.ts';
import {linkedinCapabilityView} from './capabilities.ts';
import {capsVersion} from './connections.ts';
import {linkedinSqlError} from './people.ts';
import {unipileRequest,unipileSettings,UnipileMissing,UnipileRetry,type UnipileDeps} from './unipile.ts';
// 07A.3b: the post-accept sequence of a campaign. Automatic sends only with automatic sending attested; assisted leaves drafts.
const sqlError=linkedinSqlError({
 LINKEDIN_CAMPAIGN_ACCESS:[403,'Somente proprietário ou administrador ativa, pausa ou arquiva cadências do LinkedIn.'],
 LINKEDIN_CAMPAIGN_NOT_FOUND:[404,'Campanha não encontrada.'],
 LINKEDIN_SEQUENCE_NOT_FOUND:[404,'Cadência não encontrada.'],
 LINKEDIN_SEQUENCE_LOCKED:[409,'Esta cadência já foi ativada e não muda mais. Crie outra para mudar os passos.'],
 LINKEDIN_SEQUENCE_EXISTS:[409,'Esta campanha já tem uma cadência ativa ou pausada. Arquive-a antes de ativar outra.'],
 REVISION_CONFLICT:[409,'A cadência mudou em outra aba. Recarregue antes de continuar.'],
});
export async function listLinkedinSequences(p:Principal):Promise<{sequences:LinkedinSequenceView[];mode:'automatic'|'assisted'|null}>{
 return withWorkspaceTransaction(p,async c=>{
  await c.query('SELECT app.linkedin_campaign_actor(false)');
  const cap=await linkedinCapabilityView(c);
  const rows=(await c.query(`SELECT q.id,q.name,q.steps,q.state,q.revision,q.updated_at,c.id campaign_id,c.name campaign_name,
   (SELECT coalesce(jsonb_object_agg(k,n),'{}') FROM (SELECT CASE WHEN x.state='stopped' THEN 'stopped_'||coalesce(x.reason,'other') ELSE x.state END k,count(*)::int n FROM app.linkedin_sequence_run x WHERE x.workspace_id=q.workspace_id AND x.sequence_id=q.id GROUP BY 1) s) counts
   FROM app.linkedin_sequence q JOIN app.linkedin_campaign c ON c.workspace_id=q.workspace_id AND c.id=q.campaign_id WHERE q.state<>'archived' ORDER BY q.updated_at DESC`)).rows;
  return {mode:sequenceMode(cap.capabilities),sequences:rows.map(r=>({id:r.id,name:r.name,campaign:{id:r.campaign_id,name:r.campaign_name},steps:r.steps,state:r.state,revision:Number(r.revision),counts:r.counts,updatedAt:r.updated_at.toISOString()}))};
 }).catch(e=>{throw sqlError(e);});
}
const saveInput=z.strictObject({id:z.uuid(),expectedRevision:z.number().int().min(0),sequence:sequenceDraftSchema});
export async function saveLinkedinSequence(p:Principal,raw:unknown):Promise<{id:string;revision:number}>{
 const parsed=saveInput.safeParse(raw);if(!parsed.success)throw new AppError(422,parsed.error.issues[0]?.message??'Cadência inválida.');const i=parsed.data;
 return withWorkspaceTransaction(p,async c=>({id:i.id,revision:Number((await c.query('SELECT app.save_linkedin_sequence($1,$2,$3,$4,$5) v',[i.id,i.sequence.name,i.sequence.campaignId,JSON.stringify(i.sequence.steps),i.expectedRevision])).rows[0].v)})).catch(e=>{throw sqlError(e);});
}
export async function linkedinSequenceAction(p:Principal,id:string,action:string,raw:unknown):Promise<{revision:number}>{
 const parsed=z.strictObject({expectedRevision:z.number().int().min(1)}).safeParse(raw);
 if(!parsed.success||!z.uuid().safeParse(id).success||!['activate','pause','resume','archive'].includes(action))throw new AppError(422,'Operação inválida.');
 return withWorkspaceTransaction(p,async c=>{
  if(action==='activate'||action==='resume'){const cap=await linkedinCapabilityView(c);
   if(!sequenceMode(cap.capabilities))throw new AppError(409,cap.reason||'O fornecedor habilitado não oferece o envio de mensagens.','LINKEDIN_UNAVAILABLE');}
  return {revision:Number((await c.query('SELECT app.linkedin_sequence_action($1,$2,$3) v',[id,action,parsed.data.expectedRevision])).rows[0].v)};
 }).catch(e=>{throw sqlError(e);});
}

type Claim={workspaceId:string;runId:string;stepIndex:number;body:string;name:string;company:string|null;headline:string|null;industry:string|null;proof:string|null;attendee:string;chat:string|null;external:string;epoch:string;capabilitiesVersion:string};
async function gate(pool:Pool){const c=await pool.connect();try{const v=await linkedinCapabilityView(c);return {mode:sequenceMode(v.capabilities),version:capsVersion(v)};}finally{c.release();}}
/** Worker: one due step per LinkedIn member per round, in business hours. Assisted mode never sends: it leaves a draft. */
export async function runLinkedinSequenceTick(o:{limit:number;now?:Date;signal?:AbortSignal},deps:UnipileDeps={}){
 const pool=workerPool(),token=randomUUID(),now=o.now??new Date(),out={sent:0,drafted:0,stopped:0,uncertain:0};
 if(!inviteWindowOpen(now))return out;
 for(let i=0;i<Math.max(1,o.limit)*2;i++){
  if(o.signal?.aborted)break;
  const claim=(await pool.query('SELECT app.claim_linkedin_sequence_step($1,$2) v',[token,now])).rows[0].v as Claim|null;if(!claim)break;
  const finish=(outcome:string,body:string|null,remote:string|null=null,chat:string|null=null,reason:string|null=null)=>pool.query('SELECT app.finish_linkedin_sequence_step($1,$2,$3,$4,$5,$6,$7,$8,$9)',[claim.workspaceId,claim.runId,token,outcome,body,remote,chat,reason,now]);
  const text=renderLinkedinText(claim.body,{nome:claim.name,empresa:claim.company??undefined,cargo:claim.headline??undefined,setor:claim.industry??undefined,prova:claim.proof??undefined},8000);
  if(text===null){await finish('stopped',null,null,null,'missing_fact');out.stopped++;continue;}
  const g=await gate(pool);
  if(!g.mode){await finish('held',null);continue;}
  if(g.mode==='assisted'){await finish('drafted',text);out.drafted++;continue;}
  if(!(await pool.query('SELECT app.linkedin_sequence_recheck($1,$2,$3,$4,$5) v',[claim.workspaceId,claim.runId,token,claim.epoch,g.version])).rows[0].v)continue;
  try{unipileSettings();}catch{await finish('held',null);continue;}
  try{
   const form=new FormData();form.set('text',text);
   let chat=claim.chat,remote:string|null=null;
   if(chat){const r=await unipileRequest('POST',`/api/v1/chats/${encodeURIComponent(chat)}/messages`,form,deps);remote=typeof r?.message_id==='string'?r.message_id.slice(0,200):null;}
   else{form.set('account_id',claim.external);form.set('attendees_ids',claim.attendee);
    const r=await unipileRequest('POST','/api/v1/chats',form,deps);chat=typeof r?.chat_id==='string'?r.chat_id.slice(0,200):null;remote=typeof r?.message_id==='string'?r.message_id.slice(0,200):null;}
   await finish('sent',text,remote,chat);out.sent++;
  }catch(e){
   const status=e instanceof UnipileRetry?e.status:e instanceof UnipileMissing?404:undefined;
   // No status or a 5xx: the message may have left. The sequence stops for this person; never resent.
   if(status===undefined||status>=500){await finish('uncertain',text);out.uncertain++;}
   else if(status===429||status===401||status===403)await finish('held',null);
   else{await finish('failed',text);out.stopped++;}
  }
 }
 return out;
}
