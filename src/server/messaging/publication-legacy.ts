import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {Cadence,Lead} from '../../domain/model.ts';
import type {PublicationReview,PublicationSnapshot,PublicationView} from '../../domain/cadence-runtime.ts';
import type {OutboundContent,TemplateView} from '../../domain/whatsapp.ts';
import {renderMessage,validateCadence} from '../../domain/cadence.ts';
import {evaluateSendPolicy} from '../../domain/whatsapp-policy.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {readApprovedContext} from '../context/repository.ts';
import {readAiPolicy} from '../prospecting/ai/settings.ts';
import {hashValue,createReviewToken,verifyReviewToken} from '../prospecting/review.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {AppError} from '../errors.ts';
import {requireChannelAdmin,senderView,commandHash,priorCommand,completeCommand,connectionRow} from '../channels/repository.ts';
import {contentSchema} from '../channels/schemas.ts';
import {nextStepAt} from './schedule.ts';
const id=z.string().min(1).max(120);
const publicationSchema=z.strictObject({cadenceId:id,expectedRevision:z.number().int().min(0),senderId:z.uuid(),bindings:z.record(id,contentSchema),leadIds:z.array(id).min(1).max(500).refine(v=>new Set(v).size===v.length)});
const confirmSchema=publicationSchema.extend({requestId:z.uuid(),reviewToken:z.string().max(8192)});
const secret=()=>{if(!process.env.BETTER_AUTH_SECRET)throw Error('Review signing unavailable');return process.env.BETTER_AUTH_SECRET;};
function phone(value:string|undefined){if(!value?.trim().startsWith('+'))return null;const result='+'+value.replace(/\D/g,'');return /^\+[1-9]\d{6,14}$/.test(result)?result:null;}
function templatePreview(template:TemplateView,variables:Record<string,string>){return template.components.map(c=>c.text.replace(/\{\{\s*(\w+)\s*\}\}/g,(_match,key:string)=>variables[c.type+'.'+key]??'{{'+key+'}}')).join('\n');}
export async function publicationState(c:PoolClient,p:Principal,input:z.infer<typeof publicationSchema>){
 await requireChannelAdmin(c);const revision=Number((await c.query('SELECT revision FROM app.workspace_meta WHERE workspace_id=$1',[p.workspaceId])).rows[0]?.revision??0);
 if(revision!==input.expectedRevision)throw new AppError(409,'O rascunho mudou. Revise antes de ativar.');
 const cadence=(await c.query('SELECT payload FROM app.cadence WHERE id=$1',[input.cadenceId])).rows[0]?.payload as Cadence|undefined;if(!cadence)throw new AppError(404,'Cadência não encontrada.');
 const senderRow=(await c.query('SELECT * FROM app.channel_sender WHERE id=$1',[input.senderId])).rows[0];if(!senderRow)throw new AppError(404,'Remetente não encontrado.');
 const sender=senderView(senderRow),conn=await connectionRow(c,sender.connectionId),limits=(await c.query('SELECT * FROM app.messaging_limits')).rows[0];
 const blockers:string[]=validateCadence(cadence).map(i=>'CADENCE_INVALID:'+i.field),templates=(await c.query('SELECT payload FROM app.channel_remote_template WHERE connection_id=$1',[conn.id])).rows.map(r=>r.payload as TemplateView);
 if((await c.query("SELECT id FROM app.cadence_publication WHERE cadence_id=$1 AND state='active' LIMIT 1",[cadence.id])).rowCount)blockers.push('CADENCE_ALREADY_ACTIVE');
 if(cadence.archived)blockers.push('CADENCE_ARCHIVED');
 if(!sender.ready||conn.state!=='ready'||!conn.credentials_verified||(conn.token_expires_at&&conn.token_expires_at.getTime()<=Date.now()))blockers.push('SENDER_UNAVAILABLE');
 if(!limits||!sender.dailyLimit)blockers.push('EXPLICIT_LIMITS_REQUIRED');
 if(cadence.settings.skipHolidays)blockers.push('HOLIDAY_CALENDAR_REQUIRED');
 for(const flag of ['alternateContact','distribute','reengage','corporateOnly'] as const)if(cadence.settings[flag])blockers.push('SETTING_UNAVAILABLE:'+flag);
 if(cadence.settings.budgetPercent!==null)blockers.push('SETTING_UNAVAILABLE:budgetPercent');
 for(const step of cadence.steps){if(step.channel!=='WHATSAPP')blockers.push('CHANNEL_UNAVAILABLE:'+step.id);if(!Object.hasOwn(input.bindings,step.id))blockers.push('STEP_BINDING_REQUIRED:'+step.id);if(!Number.isInteger(step.delayDays))blockers.push('INTEGER_DELAY_REQUIRED:'+step.id);}
 if(Object.keys(input.bindings).some(k=>!cadence.steps.some(s=>s.id===k)))blockers.push('UNKNOWN_STEP_BINDING');
 const context=await readApprovedContext(c),policy=await readAiPolicy(c),productId=cadence.origin?.productId??null;
 const product=productId?(await c.query('SELECT * FROM app.product_profile WHERE id=$1',[productId])).rows[0]:null;
 if(productId&&(!product||product.archived||!product.approved))blockers.push('PRODUCT_UNAVAILABLE');
 const snapshot:PublicationSnapshot={cadence,draftRevision:revision,recipients:[],bindings:input.bindings,sender,connectionRevision:Number(conn.revision),contextVersion:context?.version??0,aiRouteRevision:policy.revision,workspaceDailyLimit:limits?.workspace_daily_limit??0,senderDailyLimit:sender.dailyLimit??0,actorId:p.userId,recipientFacts:{},recipientContents:{},messagePreviews:{},templateProofs:{},productId,productVersion:product?.approved?.version??null};
 const now=new Date().toISOString();
 for(const leadId of input.leadIds){
  const lead=(await c.query('SELECT payload FROM app.lead WHERE id=$1',[leadId])).rows[0]?.payload as Lead|undefined;
  if(!lead)throw new AppError(404,'Destinatário não encontrado.');
  if(lead.listId!==cadence.listId||!cadence.settings.acceptedQualifications.includes(lead.qualification))blockers.push('LEAD_INELIGIBLE:'+leadId);
  const address=phone(lead.phone),scope=conn.provider+':'+conn.external_account_id;
  const identities=(await c.query('SELECT i.* FROM app.channel_identity i WHERE i.scope=$1 AND (i.external_id=$2 OR i.phone=$3 OR EXISTS(SELECT 1 FROM app.channel_conversation v WHERE v.workspace_id=i.workspace_id AND v.identity_id=i.id AND v.lead_id=$4 AND v.sender_id=$5)) ORDER BY i.id LIMIT 2',[scope,address?.slice(1)??null,address,leadId,sender.id])).rows;
  const identity=identities.length===1?identities[0]:null;
  if(!address)blockers.push('VALID_PHONE_REQUIRED:'+leadId);if(!identity)blockers.push((identities.length?'CONTACT_IDENTITY_AMBIGUOUS:':'CONTACT_CONSENT_REQUIRED:')+leadId);
  const consents=identity?(await c.query("SELECT id FROM app.consent_evidence WHERE identity_id=$1 AND purpose='campaign' AND occurred_at<=clock_timestamp() ORDER BY id",[identity.id])).rows:[];
  const suppressions=identity?(await c.query("SELECT scope FROM app.contact_suppression WHERE identity_id=$1 AND scope IN('all','campaign') ORDER BY scope",[identity.id])).rows:[];
  if(identity&&cadence.settings.excludeReplied&&Number(identity.reply_epoch)>0)blockers.push('LEAD_ALREADY_REPLIED:'+leadId);
  const lastInboundAt=identity?(await c.query('SELECT last_inbound_at FROM app.channel_conversation WHERE sender_id=$1 AND identity_id=$2',[sender.id,identity.id])).rows[0]?.last_inbound_at?.toISOString()??null:null;
  const record={scope,externalId:identity?.external_id??address?.slice(1)??'',phone:address};
  snapshot.recipients.push({leadId,identityId:identity?.id??'',identity:record,factsHash:hashValue({lead,identity:identity??null,consents,suppressions,lastInboundAt})});
  snapshot.recipientFacts[leadId]=lead;snapshot.recipientContents[leadId]={};snapshot.messagePreviews[leadId]={};let anchor=now;
  for(const step of cadence.steps){
   const binding=input.bindings[step.id];if(!binding)continue;
   let content:OutboundContent;
   if(binding.kind==='text')content={kind:'text',text:renderMessage(binding.text,lead).text};
   else content={...binding,variables:Object.fromEntries(Object.entries(binding.variables).map(([k,v])=>[k,renderMessage(v,lead).text]))};
   snapshot.recipientContents[leadId][step.id]=content;
   const template=content.kind==='template'?templates.find(t=>t.id===content.templateId)??null:null;
   if(template){snapshot.templateProofs[template.id]={revision:template.revision,hash:template.hash};
    if(!template.components.some(c=>c.type==='body'&&c.text.replace(/\{\{[^{}]+\}\}/g,'').trim().length>2))blockers.push('TEMPLATE_LITERAL_REQUIRED:'+step.id);
    if(binding.kind==='template'&&Object.values(binding.variables).some(v=>v.trim()===step.body.trim()&&v.trim().length>50))blockers.push('TEMPLATE_VARIABLE_IS_MESSAGE:'+step.id);
   }
   let at=now;try{at=nextStepAt({anchorAt:anchor,delayDays:step.delayDays,now:anchor,timezone:cadence.settings.timezone,weekdays:cadence.settings.weekdays,sendTime:cadence.settings.sendTime,skipHolidays:cadence.settings.skipHolidays,holidayDates:null});anchor=at;}catch{blockers.push('SCHEDULE_UNAVAILABLE:'+step.id);}
   const eligibility=evaluateSendPolicy({now:at,lastInboundAt,purpose:'campaign',hasOptIn:consents.length>0,suppressed:suppressions.length>0,senderReady:sender.ready&&conn.state==='ready',content,template});
   for(const blocker of eligibility.blockers)blockers.push(leadId+':'+step.id+':'+blocker);
   snapshot.messagePreviews[leadId][step.id]=content.kind==='text'?content.text:template?templatePreview(template,content.variables):'Template indisponível';
  }
 }
 if(Buffer.byteLength(JSON.stringify(snapshot))>2097152)throw new AppError(413,'Reduza a quantidade de destinatários ou o conteúdo da revisão.');
 return {snapshot,blockers:[...new Set(blockers)],proof:{workspaceId:p.workspaceId,userId:p.userId,input,snapshot}};
}
export async function preparePublication(p:Principal,input:unknown):Promise<PublicationReview>{
 const parsed=publicationSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Configuração da publicação inválida.');
 return withWorkspaceTransaction(p,async c=>{const state=await publicationState(c,p,parsed.data);return {token:createReviewToken(state.proof,secret()),expiresAt:new Date(Date.now()+600000).toISOString(),snapshot:state.snapshot,blockers:state.blockers};});
}
export async function confirmPublication(p:Principal,input:unknown):Promise<PublicationView>{
 const parsed=confirmSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Confirmação da publicação inválida.');const {requestId,reviewToken,...body}=parsed.data;
 return withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);await lockWorkspace(c);const hash=commandHash({action:'publication.confirm',input:body}),old=await priorCommand<PublicationView>(c,p,requestId,hash);if(old)return old;
  const state=await publicationState(c,p,body);verifyReviewToken(reviewToken,state.proof,secret());if(state.blockers.length)throw new AppError(409,'A publicação está bloqueada: '+state.blockers[0]);
  const id=randomUUID(),now=new Date().toISOString();
  await c.query("INSERT INTO app.cadence_publication(workspace_id,id,cadence_id,created_by,snapshot,state) VALUES($1,$2,$3,$4,$5,'active')",[p.workspaceId,id,body.cadenceId,p.userId,state.snapshot]);
  for(const recipient of state.snapshot.recipients){
   const step=state.snapshot.cadence.steps[0],next=nextStepAt({anchorAt:now,delayDays:step.delayDays,now,timezone:state.snapshot.cadence.settings.timezone,weekdays:state.snapshot.cadence.settings.weekdays,sendTime:state.snapshot.cadence.settings.sendTime,skipHolidays:false,holidayDates:null});
   await c.query("INSERT INTO app.cadence_enrollment(workspace_id,id,publication_id,lead_id,identity_id,anchor_at,next_at,authorized_reply_epoch) SELECT $1,$2,$3,$4,$5,$6,$7,reply_epoch FROM app.channel_identity WHERE id=$5",[p.workspaceId,randomUUID(),id,recipient.leadId,recipient.identityId,now,next]);
  }
  const result:PublicationView={id,cadenceId:body.cadenceId,revision:1,state:'active',enrollmentCount:state.snapshot.recipients.length};await completeCommand(c,p,requestId,hash,result,'publication.confirm');return result;
 });
}
export async function listPublications(p:Principal):Promise<PublicationView[]>{return withWorkspaceTransaction(p,async c=>(await c.query('SELECT p.*,count(e.id) AS enrolled FROM app.cadence_publication p LEFT JOIN app.cadence_enrollment e ON e.workspace_id=p.workspace_id AND e.publication_id=p.id GROUP BY p.workspace_id,p.id ORDER BY p.created_at DESC LIMIT 100')).rows.map(r=>({id:r.id,cadenceId:r.cadence_id,revision:Number(r.revision),state:r.state,enrollmentCount:Number(r.enrolled)})));}
const pauseSchema=z.strictObject({publicationId:z.uuid(),expectedRevision:z.number().int().min(1),requestId:z.uuid()});
export async function pausePublication(p:Principal,input:unknown):Promise<PublicationView>{
 const parsed=pauseSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Pausa inválida.');const b=parsed.data;
 return withWorkspaceTransaction(p,async c=>{await requireChannelAdmin(c);await lockWorkspace(c);const hash=commandHash({action:'publication.pause',input:b}),old=await priorCommand<PublicationView>(c,p,b.requestId,hash);if(old)return old;
  const row=(await c.query('SELECT * FROM app.cadence_publication WHERE id=$1 FOR UPDATE',[b.publicationId])).rows[0];if(!row)throw new AppError(404,'Publicação não encontrada.');if(Number(row.revision)!==b.expectedRevision)throw new AppError(409,'A publicação mudou.');
  await c.query('SELECT app.pause_cadence_publication($1)',[b.publicationId]);const count=(await c.query('SELECT count(*) FROM app.cadence_enrollment WHERE publication_id=$1',[b.publicationId])).rows[0].count;
  const result:PublicationView={id:row.id,cadenceId:row.cadence_id,revision:b.expectedRevision+1,state:'paused',enrollmentCount:Number(count)};await completeCommand(c,p,b.requestId,hash,result,'publication.pause');return result;
 });
}
