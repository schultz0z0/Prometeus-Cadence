import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {Cadence,Lead} from '../../domain/model.ts';
import type {PublicationInputV2,PublicationSnapshotV2,PublicationReviewV2,PublicationView} from '../../domain/cadence-runtime.ts';
import type {TemplateView,OutboundContent} from '../../domain/whatsapp.ts';
import {renderMessage,validateCadence} from '../../domain/cadence.ts';
import {normalizeMailAddress,validateMailContent,validateRenderedMail,evaluateMailPolicy,renderMailBody} from '../../domain/mail-policy.ts';
import {whatsappIdentityScope,whatsappPhoneExternalId} from '../../domain/whatsapp-identity.ts';
import {evaluateSendPolicy} from '../../domain/whatsapp-policy.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {readApprovedContext} from '../context/repository.ts';
import {readAiPolicy} from '../prospecting/ai/settings.ts';
import {hashValue,createReviewToken,verifyReviewToken} from '../prospecting/review.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {AppError} from '../errors.ts';
import {requireChannelAdmin,senderView,commandHash,priorCommand,completeCommand,connectionRow} from '../channels/repository.ts';
import {contentSchema} from '../channels/schemas.ts';
import {createPublicationMailMaterial,readPublicationMailMaterial,unsubscribeArtifact} from '../mail/unsubscribe-material.ts';
import {nextStepAt} from './schedule.ts';
import {readContentState,contentBlockers} from './content.ts';
import {readAttachmentProofs} from './attachments.ts';
import {chooseMessageVariant,authoringVariables,validateAuthoringVariables} from '../../domain/message-authoring.ts';
const id=z.string().min(1).max(120);
const email=z.strictObject({kind:z.literal('email'),subject:z.string().max(200),text:z.string().max(65536),signature:z.string().max(4096)});
const schema=z.strictObject({version:z.literal(2),cadenceId:id,expectedRevision:z.number().int().min(0),leadIds:z.array(id).min(1).max(500).refine(v=>new Set(v).size===v.length),steps:z.record(id,z.strictObject({senderId:z.uuid(),content:z.union([email,contentSchema])}))});
const confirmSchema=schema.extend({requestId:z.uuid(),reviewToken:z.string().max(8192),material:z.string().max(262144)});
const secret=()=>{if(!process.env.BETTER_AUTH_SECRET)throw Error('Review signing unavailable');return process.env.BETTER_AUTH_SECRET;};
export async function publicationV2State(c:PoolClient,p:Principal,input:PublicationInputV2,material:string){
 await requireChannelAdmin(c);
 const revision=Number((await c.query('SELECT revision FROM app.workspace_meta WHERE workspace_id=$1',[p.workspaceId])).rows[0]?.revision??0);
 if(revision!==input.expectedRevision)throw new AppError(409,'O rascunho mudou. Revise antes de ativar.');
 const cadence=(await c.query('SELECT payload FROM app.cadence WHERE id=$1',[input.cadenceId])).rows[0]?.payload as Cadence|undefined;
 if(!cadence)throw new AppError(404,'Cadência não encontrada.');
 const tokens=readPublicationMailMaterial(p,input,material),limits=(await c.query('SELECT * FROM app.messaging_limits')).rows[0],channelLimits=(await c.query('SELECT * FROM app.messaging_channel_limits ORDER BY channel')).rows;
 const blockers=validateCadence(cadence).map(i=>'CADENCE_INVALID:'+i.field);
 if(cadence.archived)blockers.push('CADENCE_ARCHIVED');
 if((await c.query("SELECT id FROM app.cadence_publication WHERE cadence_id=$1 AND state='active'",[cadence.id])).rowCount)blockers.push('CADENCE_ALREADY_ACTIVE');
 if(!limits)blockers.push('EXPLICIT_LIMITS_REQUIRED');
 if(cadence.settings.skipHolidays)blockers.push('HOLIDAY_CALENDAR_REQUIRED');
 for(const flag of ['alternateContact','distribute','reengage','corporateOnly'] as const)if(cadence.settings[flag])blockers.push('SETTING_UNAVAILABLE:'+flag);
 if(cadence.settings.budgetPercent!==null)blockers.push('SETTING_UNAVAILABLE:budgetPercent');
 for(const step of cadence.steps){if(!Object.hasOwn(input.steps,step.id))blockers.push('STEP_BINDING_REQUIRED:'+step.id);if(!Number.isInteger(step.delayDays))blockers.push('INTEGER_DELAY_REQUIRED:'+step.id);if(!['EMAIL','WHATSAPP'].includes(step.channel))blockers.push('CHANNEL_UNAVAILABLE:'+step.id);}
 if(Object.keys(input.steps).some(k=>!cadence.steps.some(s=>s.id===k)))blockers.push('UNKNOWN_STEP_BINDING');
 const authored=await readContentState(c,cadence.id);blockers.push(...await contentBlockers(c,cadence));
 const context=await readApprovedContext(c),policy=await readAiPolicy(c),productId=cadence.origin?.productId??null;
 const product=productId?(await c.query('SELECT * FROM app.product_profile WHERE id=$1',[productId])).rows[0]:null;
 if(productId&&(!product||product.archived||!product.approved))blockers.push('PRODUCT_UNAVAILABLE');
 const snapshot:PublicationSnapshotV2={version:2,contentRevision:authored.revision,contentHash:authored.hash,cadence,draftRevision:revision,actorId:p.userId,recipients:[],recipientFacts:{},contextVersion:context?.version??0,aiRouteRevision:policy.revision,productId,productVersion:product?.approved?.version??null,limits:{workspaceDailyLimit:limits?.workspace_daily_limit??0,channels:{},senders:{}}};
 const seen=new Set<string>(),proofFacts:unknown[]=[];
 for(const row of channelLimits)snapshot.limits.channels[row.channel as 'EMAIL'|'WHATSAPP']=row.daily_limit;
 for(const leadId of input.leadIds){
  const lead=(await c.query('SELECT payload FROM app.lead WHERE id=$1',[leadId])).rows[0]?.payload as Lead|undefined;if(!lead)throw new AppError(404,'Destinatário não encontrado.');
  if(lead.listId!==cadence.listId||!cadence.settings.acceptedQualifications.includes(lead.qualification))blockers.push('LEAD_INELIGIBLE:'+leadId);
  snapshot.recipientFacts[leadId]=lead;const enrollmentHash=hashValue({material,leadId}),enrollmentId=enrollmentHash.slice(0,8)+'-'+enrollmentHash.slice(8,12)+'-5'+enrollmentHash.slice(13,16)+'-a'+enrollmentHash.slice(17,20)+'-'+enrollmentHash.slice(20,32),recipient:PublicationSnapshotV2['recipients'][number]={leadId,enrollmentId,steps:{}};snapshot.recipients.push(recipient);
  let anchor=new Date().toISOString();
  for(const step of cadence.steps){
   const binding=input.steps[step.id];if(!binding)continue;
   const sr=(await c.query('SELECT * FROM app.channel_sender WHERE id=$1',[binding.senderId])).rows[0];if(!sr)throw new AppError(404,'Remetente não encontrado.');
   const sender={...senderView(sr),channel:sr.channel as 'EMAIL'|'WHATSAPP'},conn=await connectionRow(c,sender.connectionId);
   if(sender.channel!==step.channel||conn.channel!==step.channel)blockers.push('SENDER_CHANNEL_MISMATCH:'+step.id);
   if(!sender.ready||conn.state!=='ready'||!conn.credentials_verified||(conn.token_expires_at&&conn.token_expires_at.getTime()<=Date.now()))blockers.push('SENDER_UNAVAILABLE:'+step.id);
   if(!sender.dailyLimit)blockers.push('EXPLICIT_LIMITS_REQUIRED:'+step.id);snapshot.limits.senders[sender.id]=sender.dailyLimit??0;
   if(step.variantB||step.attachmentIds?.length){if(binding.content.kind==='email'&&(binding.content.text!==step.body||binding.content.subject!==(step.subject??''))||binding.content.kind==='text'&&binding.content.text!==step.body)blockers.push('CONTENT_BINDING_CHANGED:'+step.id);}
   const variant=chooseMessageVariant(enrollmentId,!!step.variantB?.body.trim()&&(step.channel!=='EMAIL'||!!step.variantB.subject?.trim())),selected=variant==='B'?step.variantB!:step,attachments=await readAttachmentProofs(c,selected.attachmentIds??[],step.channel);blockers.push(...attachments.blockers);
   let address='',scope='',content=binding.content,preview='',template:TemplateView|null=null,lastInboundAt:string|null=null,mailbox:any=null;
   if(variant==='B'){if(content.kind==='email')content={...content,subject:selected.subject??'',text:selected.body};else if(content.kind==='text')content={...content,text:selected.body};else blockers.push('VARIANT_TEMPLATE_UNSUPPORTED:'+step.id);}
   const values=content.kind==='template'?Object.values(content.variables):content.kind==='email'?[content.subject,content.text]:[content.text];for(const value of values){const vars=validateAuthoringVariables({body:value,allowed:authoringVariables});if(!vars.valid)blockers.push('UNKNOWN_VARIABLE:'+step.id+':'+vars.unknown.join(','));if(renderMessage(value,lead).unresolved.length)blockers.push('MISSING_VARIABLE_VALUE:'+step.id);}
   if(step.channel==='EMAIL'){
    try{address=normalizeMailAddress(lead.email??'');}catch{blockers.push('VALID_EMAIL_REQUIRED:'+leadId);}
    scope='email';mailbox=(await c.query('SELECT * FROM app.email_mailbox WHERE id=$1',[conn.id])).rows[0];
    if(content.kind!=='email')blockers.push('EMAIL_CONTENT_REQUIRED:'+step.id);
    else {content={kind:'email',subject:renderMessage(content.subject,lead).text,text:renderMessage(content.text,lead).text,signature:content.signature};blockers.push(...validateMailContent(content).map(b=>b+':'+step.id));if(content.signature!==mailbox?.signature)blockers.push('MAIL_SIGNATURE_CHANGED:'+step.id);preview=content.subject+'\n\n'+content.text+(content.signature?'\n\n'+content.signature:'');}
    if(!snapshot.limits.channels.EMAIL)blockers.push('EMAIL_LIMIT_REQUIRED');
   }else{
    address=lead.phone?.trim().startsWith('+')?'+'+lead.phone.replace(/\D/g,''):'';if(!/^\+[1-9]\d{6,14}$/.test(address))blockers.push('VALID_PHONE_REQUIRED:'+leadId);
    scope=whatsappIdentityScope(conn.provider,conn.id,conn.external_account_id);
    if(content.kind==='email')blockers.push('WHATSAPP_CONTENT_REQUIRED:'+step.id);
    else if(content.kind==='text'){content={kind:'text',text:renderMessage(content.text,lead).text};preview=content.text;}
    else{content={...content,variables:Object.fromEntries(Object.entries(content.variables).map(([k,v])=>[k,renderMessage(v,lead).text]))};template=(await c.query('SELECT payload FROM app.channel_remote_template WHERE connection_id=$1 AND id=$2',[conn.id,content.templateId])).rows[0]?.payload??null;
     if(template){preview=template.components.map(component=>component.text.replace(/\{\{\s*(\w+)\s*\}\}/g,(_m,key:string)=>content.kind==='template'?(content.variables[component.type+'.'+key]??'{{'+key+'}}'):'')).join('\n');if(!template.components.some(component=>component.type==='body'&&component.text.replace(/\{\{[^{}]+\}\}/g,'').trim().length>2))blockers.push('TEMPLATE_LITERAL_REQUIRED:'+step.id);if(binding.content.kind==='template'&&Object.values(binding.content.variables).some(v=>v.trim()===step.body.trim()&&v.trim().length>50))blockers.push('TEMPLATE_VARIABLE_IS_MESSAGE:'+step.id);}
    }
   }
   const external=scope==='email'?address:whatsappPhoneExternalId(scope,address),identities=(await c.query('SELECT * FROM app.channel_identity WHERE scope=$1 AND external_id=$2 ORDER BY id LIMIT 2',[scope,external])).rows,person=identities.length===1?identities[0]:null;
   const consents=person?(await c.query("SELECT id FROM app.consent_evidence WHERE identity_id=$1 AND purpose='campaign' AND occurred_at<=clock_timestamp() ORDER BY id",[person.id])).rows:[],suppressions=person?(await c.query("SELECT * FROM app.contact_suppression WHERE identity_id=$1 AND scope IN('all','campaign') ORDER BY scope",[person.id])).rows:[];
   if(!person)blockers.push('CONTACT_CONSENT_REQUIRED:'+leadId+':'+step.id);
   if(person&&cadence.settings.excludeReplied&&Number(person.reply_epoch)>0)blockers.push('LEAD_ALREADY_REPLIED:'+leadId);
   if(person)lastInboundAt=(await c.query('SELECT max(last_inbound_at) AS at FROM app.channel_conversation WHERE sender_id=$1 AND identity_id=$2',[sender.id,person.id])).rows[0]?.at?.toISOString()??null;
   let at=anchor;try{at=nextStepAt({anchorAt:anchor,delayDays:step.delayDays,now:anchor,timezone:cadence.settings.timezone,weekdays:cadence.settings.weekdays,sendTime:cadence.settings.sendTime,skipHolidays:cadence.settings.skipHolidays,holidayDates:null});anchor=at;}catch{blockers.push('SCHEDULE_UNAVAILABLE:'+step.id);}
   const eligibility=step.channel==='EMAIL'?evaluateMailPolicy({now:new Date().toISOString(),purpose:'campaign',authorized:consents.length>0,suppressed:suppressions.length>0,hasInbound:!!lastInboundAt,sendReady:sender.ready&&mailbox?.state==='ready'&&!mailbox?.bounce_paused,syncState:mailbox?.sync_state??'error',lastSyncedAt:mailbox?.last_synced_at?.toISOString()??null}):evaluateSendPolicy({provider:conn.provider,now:at,lastInboundAt,purpose:'campaign',hasOptIn:consents.length>0,suppressed:suppressions.length>0,senderReady:sender.ready&&conn.state==='ready',content:content as OutboundContent,template});
   blockers.push(...eligibility.blockers.map(b=>leadId+':'+step.id+':'+b));
   const unsubscribe=step.channel==='EMAIL'?unsubscribeArtifact(tokens[leadId]):null;
   if(step.channel==='EMAIL'){if(!unsubscribe)blockers.push('EMAIL_PUBLIC_URL_REQUIRED');if(content.kind==='email'){blockers.push(...validateRenderedMail(content,unsubscribe?.url??null).map(b=>b+':'+step.id));preview=content.subject+'\n\n'+renderMailBody(content,unsubscribe?.url??null);}}
   const key=step.id+':'+scope+':'+address;if(seen.has(key))blockers.push('DUPLICATE_RECIPIENT:'+step.id);seen.add(key);
   recipient.steps[step.id]={variant,attachments:attachments.files,sender:{...sender,provider:conn.provider},connectionRevision:Number(conn.revision),identityId:person?.id??'',address,identity:scope==='email'?{channel:'EMAIL',scope:'email',address}:{scope,externalId:external,phone:address},content,preview,consentIds:consents.map(r=>r.id),suppressionVersion:hashValue(suppressions),replyEpoch:Number(person?.reply_epoch??0),...(unsubscribe?{unsubscribe}:{}),...(template?{templateProof:{revision:template.revision,hash:template.hash}}:{})};
   proofFacts.push({leadId,stepId:step.id,mailbox,person,lastInboundAt});
  }
 }
 if(Buffer.byteLength(JSON.stringify(snapshot))>2097152)throw new AppError(413,'Reduza a quantidade de destinatários ou o conteúdo da revisão.');
 return {snapshot,blockers:[...new Set(blockers)],proof:{workspaceId:p.workspaceId,userId:p.userId,input,snapshot,proofFacts,channelLimits}};
}
export async function preparePublicationV2(p:Principal,input:unknown):Promise<PublicationReviewV2>{
 const parsed=schema.safeParse(input);if(!parsed.success)throw new AppError(422,'Configuração da publicação inválida.');
 const material=createPublicationMailMaterial(p,parsed.data);return withWorkspaceTransaction(p,async c=>{const state=await publicationV2State(c,p,parsed.data,material);return {material,token:createReviewToken(state.proof,secret()),expiresAt:new Date(Date.now()+600000).toISOString(),snapshot:state.snapshot,blockers:state.blockers};});
}
export async function confirmPublicationV2(p:Principal,input:unknown):Promise<PublicationView>{
 const parsed=confirmSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Confirmação da publicação inválida.');const {requestId,reviewToken,material,...body}=parsed.data;
 return withWorkspaceTransaction(p,async c=>{await requireChannelAdmin(c);await lockWorkspace(c);const hash=commandHash({action:'publication.v2.confirm',input:{...body,material}}),prior=await priorCommand<PublicationView>(c,p,requestId,hash);if(prior)return prior;
  const state=await publicationV2State(c,p,body,material);verifyReviewToken(reviewToken,state.proof,secret());if(state.blockers.length)throw new AppError(409,'A publicação está bloqueada: '+state.blockers[0]);
  const publicationId=randomUUID(),now=new Date().toISOString();await c.query("INSERT INTO app.cadence_publication(workspace_id,id,cadence_id,created_by,snapshot,state) VALUES($1,$2,$3,$4,$5,'active')",[p.workspaceId,publicationId,body.cadenceId,p.userId,state.snapshot]);
  for(const recipient of state.snapshot.recipients){const enrollmentId=recipient.enrollmentId??randomUUID(),settings=state.snapshot.cadence.settings,step=state.snapshot.cadence.steps[0],next=nextStepAt({anchorAt:now,delayDays:step.delayDays,now,timezone:settings.timezone,weekdays:settings.weekdays,sendTime:settings.sendTime,skipHolidays:false,holidayDates:null});
   await c.query('INSERT INTO app.cadence_enrollment(workspace_id,id,publication_id,lead_id,identity_id,anchor_at,next_at,authorized_reply_epoch) VALUES($1,$2,$3,$4,NULL,$5,$6,0)',[p.workspaceId,enrollmentId,publicationId,recipient.leadId,now,next]);
   for(const [index,entry]of state.snapshot.cadence.steps.entries()){const frozen=recipient.steps[entry.id];await c.query('INSERT INTO app.cadence_enrollment_channel(workspace_id,enrollment_id,step_index,step_id,channel,identity_id,sender_id,authorized_reply_epoch) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[p.workspaceId,enrollmentId,index,entry.id,entry.channel,frozen.identityId,frozen.sender.id,frozen.replyEpoch]);if(frozen.unsubscribe)await c.query('SELECT app.register_mail_unsubscribe($1,$2)',[frozen.identityId,frozen.unsubscribe.hash]);}
  }
  const result:PublicationView={id:publicationId,cadenceId:body.cadenceId,revision:1,state:'active',enrollmentCount:state.snapshot.recipients.length};await completeCommand(c,p,requestId,hash,result,'publication.v2.confirm');return result;
 });
}
