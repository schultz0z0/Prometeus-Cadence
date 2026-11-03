import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import {linkedinActionAllowed} from '../../domain/linkedin-capabilities.ts';
import {campaignBlockers,campaignDraftSchema,campaignSourceSchema,LINKEDIN_DAILY_CAP,type AudienceSample,type LinkedinCampaignView} from '../../domain/linkedin-campaign.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {linkedinCapabilityView} from './capabilities.ts';
import {capsVersion} from './connections.ts';
import {audiencePage,audienceQuery,sampleOf} from './audience.ts';
import {UnipileMissing,UnipileRetry,type UnipileDeps} from './unipile.ts';
const failures:Record<string,[number,string]>={
 LINKEDIN_CAMPAIGN_ACCESS:[403,'Somente proprietário ou administrador ativa, pausa ou cancela campanhas do LinkedIn.'],
 LINKEDIN_CAMPAIGN_NOT_FOUND:[404,'Campanha não encontrada.'],
 LINKEDIN_CAMPAIGN_LOCKED:[409,'Esta campanha já foi ativada e não muda mais. Crie outra para mudar a mira.'],
 LINKEDIN_CAMPAIGN_BLOCKED:[409,'Resolva os bloqueios da revisão antes de ativar.'],
 REVISION_CONFLICT:[409,'A campanha mudou em outra aba. Recarregue antes de continuar.'],
};
const sqlError=(e:unknown)=>{const k=e instanceof Error?failures[e.message]:undefined;return k?new AppError(k[0],k[1],e instanceof Error?e.message:undefined):e;};
const tx=<T,>(p:Principal,fn:(c:PoolClient)=>Promise<T>)=>withWorkspaceTransaction(p,fn).catch(e=>{throw sqlError(e);});
type Live={id:string;external:string;state:string;capabilitiesVersion:string}|null;
const live=async(c:PoolClient)=>(await c.query('SELECT app.linkedin_live_account() v')).rows[0].v as Live;

export async function listLinkedinCampaigns(p:Principal):Promise<{campaigns:LinkedinCampaignView[]}>{
 return tx(p,async c=>{
  const rows=(await c.query(`SELECT c.id,c.name,c.state,c.revision,c.draft,c.accept_list_id,c.other_list_id,c.collect_done,c.last_error,c.updated_at,
   (SELECT coalesce(jsonb_object_agg(state,n),'{}') FROM (SELECT state,count(*)::int n FROM app.linkedin_campaign_person x WHERE x.workspace_id=c.workspace_id AND x.campaign_id=c.id GROUP BY state) s) counts
   FROM app.linkedin_campaign c ORDER BY c.created_at DESC`)).rows;
  return {campaigns:rows.map(r=>({id:r.id,name:r.name,state:r.state,revision:Number(r.revision),draft:r.draft,acceptListId:r.accept_list_id,otherListId:r.other_list_id,counts:r.counts,
   collectDone:r.collect_done,lastError:r.last_error,updatedAt:r.updated_at.toISOString()}))};
 });
}
const saveInput=z.strictObject({id:z.uuid(),expectedRevision:z.number().int().min(0),draft:campaignDraftSchema});
export async function saveLinkedinCampaign(p:Principal,raw:unknown):Promise<{id:string;revision:number}>{
 const parsed=saveInput.safeParse(raw);if(!parsed.success)throw new AppError(422,parsed.error.issues[0]?.message??'Rascunho inválido.');
 const {id,expectedRevision,draft}=parsed.data;
 return tx(p,async c=>({id,revision:Number((await c.query('SELECT app.save_linkedin_campaign($1,$2,$3,$4) v',[id,draft.name,draft,expectedRevision])).rows[0].v)}));
}
/** Real audience preview: count and a sample of up to 10 people. Free and saves nothing; refused filters call nothing. */
export async function exploreLinkedinAudience(p:Principal,raw:unknown,deps:UnipileDeps={}):Promise<{total:number|null;sample:AudienceSample[]}>{
 const parsed=campaignSourceSchema.safeParse(raw);if(!parsed.success)throw new AppError(422,parsed.error.issues[0]?.message??'Público inválido.');
 const account=await tx(p,async c=>{const cap=await linkedinCapabilityView(c),a=await live(c);
  if(!linkedinActionAllowed(cap.capabilities,'audience'))throw new AppError(409,cap.reason||'O fornecedor habilitado não oferece a busca de público.','LINKEDIN_UNAVAILABLE');
  if(!a||a.state!=='ready'||a.capabilitiesVersion!==capsVersion(cap))throw new AppError(409,'Conecte uma conta LinkedIn pronta para explorar o público.','LINKEDIN_ACCOUNT_NOT_READY');
  return a.external;});
 try{
  const query=await audienceQuery(account,parsed.data,deps),page=await audiencePage(account,query,null,deps);
  return {total:page.total,sample:page.people.slice(0,10).map(sampleOf)};
 }catch(e){if(e instanceof UnipileRetry||e instanceof UnipileMissing)throw new AppError(503,'O LinkedIn não respondeu à busca agora. Tente de novo em instantes.','LINKEDIN_SEARCH_FAILED');throw e;}
}
async function review(c:PoolClient,id:string,revision:number){
 const row=(await c.query('SELECT draft,state,revision FROM app.linkedin_campaign WHERE id=$1',[id])).rows[0];
 if(!row)throw new AppError(...failures.LINKEDIN_CAMPAIGN_NOT_FOUND,'LINKEDIN_CAMPAIGN_NOT_FOUND');
 if(Number(row.revision)!==revision)throw new AppError(...failures.REVISION_CONFLICT,'REVISION_CONFLICT');
 const draft=campaignDraftSchema.parse(row.draft),cap=await linkedinCapabilityView(c),a=await live(c);
 const blockers=campaignBlockers(draft,{accountReady:!!a&&a.state==='ready'&&a.capabilitiesVersion===capsVersion(cap),capabilities:cap.capabilities});
 if(row.state!=='draft')blockers.push(failures.LINKEDIN_CAMPAIGN_LOCKED[1]);
 return {draft,blockers,account:a};
}
/** The review: blockers, plus an illustrative estimate kept apart from the real audience (which comes from exploring). */
export async function prepareLinkedinCampaign(p:Principal,raw:unknown){
 const parsed=z.strictObject({id:z.uuid(),revision:z.number().int().min(1)}).safeParse(raw);if(!parsed.success)throw new AppError(422,'Revisão inválida.');
 return tx(p,async c=>{const r=await review(c,parsed.data.id,parsed.data.revision),daily=Math.min(r.draft.dailyLimit,LINKEDIN_DAILY_CAP);
  return {blockers:r.blockers,warnings:['O limite diário é um teto próprio e conservador, não uma garantia do LinkedIn sobre a conta.'],
   estimate:{label:'Cenário ilustrativo, não é resultado nem promessa',invitesPer22Days:daily*22,dailyLimit:daily}};});
}
export async function confirmLinkedinCampaign(p:Principal,raw:unknown):Promise<{state:'active';revision:number}>{
 const parsed=z.strictObject({id:z.uuid(),revision:z.number().int().min(1)}).safeParse(raw);if(!parsed.success)throw new AppError(422,'Ativação inválida.');
 return tx(p,async c=>{
  await c.query('SELECT app.linkedin_campaign_actor(true)').catch(e=>{throw sqlError(e);});
  const r=await review(c,parsed.data.id,parsed.data.revision);
  if(r.blockers.length)throw new AppError(409,r.blockers[0],'LINKEDIN_CAMPAIGN_BLOCKED');
  const other=r.draft.otherList==='new'?randomUUID():null;
  const revision=Number((await c.query('SELECT app.activate_linkedin_campaign($1,$2,$3,$4,$5,$6,$7) v',[parsed.data.id,parsed.data.revision,r.account!.id,randomUUID(),
   `LinkedIn · ${r.draft.name} · aceites`,other,`LinkedIn · ${r.draft.name} · não aceites`])).rows[0].v);
  return {state:'active' as const,revision};
 });
}
export async function linkedinCampaignAction(p:Principal,id:string,action:string,raw:unknown){
 const parsed=z.strictObject({expectedRevision:z.number().int().min(1)}).safeParse(raw);
 if(!parsed.success||!z.uuid().safeParse(id).success||!['pause','resume','cancel'].includes(action))throw new AppError(422,'Operação inválida.');
 return tx(p,async c=>{
  if(action==='resume'){const cap=await linkedinCapabilityView(c),a=await live(c);
   if(!a||a.state!=='ready'||a.capabilitiesVersion!==capsVersion(cap))throw new AppError(409,'Conecte uma conta LinkedIn pronta antes de retomar.','LINKEDIN_ACCOUNT_NOT_READY');}
  return {revision:Number((await c.query('SELECT app.linkedin_campaign_action($1,$2,$3) v',[id,action,parsed.data.expectedRevision])).rows[0].v)};
 });
}
