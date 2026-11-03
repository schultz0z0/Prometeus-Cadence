import 'server-only';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {linkedinActionAllowed,type LinkedinCapabilityKey} from '../../domain/linkedin-capabilities.ts';
import {campaignSourceSchema,inviteWindowOpen,linkedinInviteEligible,renderInviteNote} from '../../domain/linkedin-campaign.ts';
import {workerPool} from '../prospecting/worker-db.ts';
import {linkedinCapabilityView} from './capabilities.ts';
import {capsVersion} from './connections.ts';
import {audiencePage,audienceQuery} from './audience.ts';
import {unipileRequest,UnipileMissing,UnipileRetry,type UnipileDeps} from './unipile.ts';
// 07A.2 worker: collect audiences, send invites one at a time per account, detect acceptances, withdraw expired invites.
export interface CampaignTickDeps extends UnipileDeps{afterClaim?:()=>Promise<unknown>}
async function gate(pool:Pool,key:LinkedinCapabilityKey){
 const c=await pool.connect();try{const v=await linkedinCapabilityView(c);return linkedinActionAllowed(v.capabilities,key)?capsVersion(v):null;}finally{c.release();}
}
const msg=(e:unknown)=>e instanceof Error?e.message.slice(0,300):'Falha desconhecida.';
async function collect(pool:Pool,token:string,limit:number,deps:UnipileDeps){
 const version=await gate(pool,'audience');if(!version)return 0;
 const items=(await pool.query('SELECT app.claim_linkedin_collect($1,$2) v',[token,limit])).rows[0].v as {workspaceId:string;id:string;source:unknown;cursor:string|null;external:string;capabilitiesVersion:string}[];
 let people=0;
 for(const it of items){
  let found:unknown[]=[],cursor:string|null=null,error:string|null=null;
  if(it.capabilitiesVersion!==version)error='A conta LinkedIn precisa ser verificada de novo.';
  else try{
   const source=campaignSourceSchema.parse(it.source),page=await audiencePage(it.external,await audienceQuery(it.external,source,deps),it.cursor,deps);
   // Collection only keeps who can be invited: never a 1st-degree connection or someone with a pending invite.
   found=page.people.filter(p=>linkedinInviteEligible({connectedAlready:p.degree===1,pendingInvite:p.pending,approved:true}));cursor=page.cursor;people+=found.length;
  }catch(e){error=msg(e);}
  await pool.query('SELECT app.finish_linkedin_collect($1,$2,$3,$4,$5,$6,$7)',[it.workspaceId,it.id,token,JSON.stringify(found),cursor,cursor===null,error]);
 }
 return people;
}
type Claim={workspaceId:string;accountId:string;external:string;epoch:string;capabilitiesVersion:string;campaignId:string;personId:string;providerId:string;name:string;company:string|null;headline:string|null;note:string;proof:string;industry:string|null};
const nextBrasiliaMorning=(now:Date)=>{const d=new Date(now.getTime()-3*3600e3);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+1,12));};
async function invite(pool:Pool,token:string,now:Date,deps:CampaignTickDeps){
 const out={sent:0,uncertain:0};
 if(!inviteWindowOpen(now))return out;
 for(let i=0;i<20;i++){
  const claim=(await pool.query('SELECT app.claim_linkedin_invite($1,$2) v',[token,now])).rows[0].v as Claim|null;if(!claim)break;
  const finish=(outcome:string,reason:string|null,invitation:string|null=null,hold:Date|null=null)=>pool.query('SELECT app.finish_linkedin_invite($1,$2,$3,$4,$5,$6,$7,$8)',[claim.workspaceId,claim.personId,token,outcome,reason,invitation,hold,now]);
  const message=renderInviteNote(claim.note??'',{nome:claim.name,empresa:claim.company??undefined,cargo:claim.headline??undefined,setor:claim.industry??undefined,prova:claim.proof});
  if(message===null){await finish('skipped','Falta um dado do perfil para a nota; nada foi inventado.');continue;}
  await deps.afterClaim?.();
  // Right before the call: gate, campaign and account read again; anything changed undoes the claim.
  const version=await gate(pool,'invite');
  if(!(await pool.query('SELECT app.linkedin_invite_recheck($1,$2,$3,$4,$5) v',[claim.workspaceId,claim.personId,token,claim.epoch,version])).rows[0].v)continue;
  try{
   const r=await unipileRequest('POST','/api/v1/users/invite',{provider_id:claim.providerId,account_id:claim.external,...(message?{message}:{})},deps);
   await finish('sent',null,typeof r?.invitation_id==='string'?r.invitation_id.slice(0,200):null);out.sent++;
  }catch(e){
   const status=e instanceof UnipileRetry?e.status:e instanceof UnipileMissing?404:undefined;
   // No status (network, timeout) or a 5xx: the invite may have left. Never resend.
   if(status===undefined||status>=500){await finish('uncertain','Sem confirmação do LinkedIn; o convite não será reenviado.');out.uncertain++;}
   else if(status===429)await finish('held','O LinkedIn limitou os convites desta conta por hoje.',null,nextBrasiliaMorning(now));
   else if(status===401||status===403)await finish('held','O fornecedor recusou a chave da plataforma.',null,new Date(now.getTime()+3600e3));
   else await finish('failed',`O LinkedIn recusou o convite${e instanceof UnipileRetry&&e.type?` (${e.type})`:''}.`);
  }
 }
 return out;
}
async function relationIds(external:string,deps:UnipileDeps){
 const ids=new Set<string>();let cursor:string|null=null;
 // Newest first; a few pages a check, as Unipile recommends few relation reads a day.
 for(let page=0;page<3;page++){
  const r=await unipileRequest('GET','/api/v1/users/relations?'+new URLSearchParams({account_id:external,limit:'100',...(cursor?{cursor}:{})}),undefined,deps);
  for(const i of Array.isArray(r?.items)?r.items:[])if(typeof i?.member_id==='string')ids.add(i.member_id);
  cursor=typeof r?.cursor==='string'&&r.cursor?r.cursor:null;if(!cursor)break;
 }
 return ids;
}
async function contactOf(external:string,providerId:string,deps:UnipileDeps){
 try{const r=await unipileRequest('GET',`/api/v1/users/${encodeURIComponent(providerId)}?`+new URLSearchParams({account_id:external}),undefined,deps);
  const email=r?.contact_info?.emails?.[0],phone=r?.contact_info?.phones?.[0];
  return {...(typeof email==='string'&&email.includes('@')?{email:email.slice(0,250)}:{}),...(typeof phone==='string'?{phone:phone.slice(0,50)}:{})};}
 catch{return {};}
}
async function accept(pool:Pool,now:Date,limit:number,deps:UnipileDeps){
 const version=await gate(pool,'acceptance');if(!version)return 0;
 const accounts=(await pool.query('SELECT app.claim_linkedin_accept($1,$2) v',[now,limit])).rows[0].v as {workspaceId:string;external:string;capabilitiesVersion:string;waiting:{personId:string;providerId:string;enrich:boolean}[]}[];
 let accepted=0;
 for(const a of accounts){
  if(a.capabilitiesVersion!==version)continue;
  let ids:Set<string>;try{ids=await relationIds(a.external,deps);}catch{continue;}
  for(const w of a.waiting??[]){
   if(!ids.has(w.providerId))continue;
   const contact=w.enrich?await contactOf(a.external,w.providerId,deps):{};
   if((await pool.query('SELECT app.accept_linkedin_person($1,$2,$3,$4) v',[a.workspaceId,w.personId,contact,now])).rows[0].v)accepted++;
  }
 }
 return accepted;
}
async function expire(pool:Pool,now:Date,limit:number,deps:UnipileDeps){
 const version=await gate(pool,'invite');if(!version)return 0;
 const items=(await pool.query('SELECT app.claim_linkedin_expired($1,$2) v',[now,limit])).rows[0].v as {workspaceId:string;personId:string;invitationId:string;external:string;capabilitiesVersion:string}[];
 let expired=0;
 for(const it of items){
  if(it.capabilitiesVersion!==version)continue;
  try{await unipileRequest('DELETE',`/api/v1/users/invite/sent/${encodeURIComponent(it.invitationId)}?`+new URLSearchParams({account_id:it.external}),undefined,deps);}
  catch(e){if(!(e instanceof UnipileMissing))continue;}
  if((await pool.query('SELECT app.expire_linkedin_person($1,$2,$3) v',[it.workspaceId,it.personId,now])).rows[0].v)expired++;
 }
 return expired;
}
/** One pass of the campaign lane. `now` is injectable for tests; production passes the clock. */
export async function runLinkedinCampaignTick(o:{limit:number;now?:Date;signal?:AbortSignal},deps:CampaignTickDeps={}){
 const pool=workerPool(),token=randomUUID(),now=o.now??new Date();
 const collected=await collect(pool,token,o.limit,deps);if(o.signal?.aborted)return {collected,sent:0,uncertain:0,accepted:0,expired:0};
 const sent=await invite(pool,token,now,deps);
 const accepted=o.signal?.aborted?0:await accept(pool,now,o.limit,deps),expired=o.signal?.aborted?0:await expire(pool,now,o.limit,deps);
 return {collected,...sent,accepted,expired};
}
