import type {PreparedSend,TemplateView} from '../../domain/whatsapp.ts';
import {evaluateSendPolicy} from '../../domain/whatsapp-policy.ts';
import {hashValue} from '../prospecting/review.ts';
export function dispatchBlocker(ctx:Record<string,any>,now:string):string|null {
 if(ctx.blocker)return ctx.blocker;
 const {outbox:o,connection:c,sender:s,identity:i}=ctx,send=o.prepared_send as PreparedSend;
 if(c.state!=='ready'||!c.credentials_verified||Number(c.revision)!==send.connectionRevision||!s.ready||Number(s.revision)!==Number(o.proof.senderRevision)||(c.token_expires_at&&Date.parse(c.token_expires_at)<=Date.parse(now)))return 'CONNECTION_CHANGED';
 if(i.scope!==send.identity.scope||i.external_id!==send.identity.externalId||i.phone!==send.identity.phone)return 'CONTACT_CHANGED';
 const publication=ctx.publication?.id?ctx.publication:null;
 if(publication){
  const frozen=publication.snapshot,enrollment=ctx.enrollment,step=frozen.cadence.steps[o.step_index];
  if(publication.state!=='active'||enrollment?.state!=='active'||Number(enrollment.next_step)!==o.step_index)return 'PUBLICATION_CHANGED';
  if(Number(frozen.contextVersion)!==Number(ctx.contextVersion)||Number(frozen.aiRouteRevision)!==Number(ctx.aiRevision))return 'CONTEXT_OR_ROUTE_CHANGED';
  if(frozen.productId&&(ctx.product?.archived||Number(ctx.product?.version)!==Number(frozen.productVersion)))return 'PRODUCT_CHANGED';
  if(hashValue(ctx.lead)!==hashValue(frozen.recipientFacts[enrollment.lead_id]))return 'LEAD_CHANGED';
  if(Number(frozen.sender.revision)!==Number(s.revision)||Number(frozen.workspaceDailyLimit)!==Number(ctx.limits?.workspace_daily_limit)||Number(frozen.senderDailyLimit)!==Number(s.daily_limit))return 'LIMITS_CHANGED';
  if(!step||step.channel!=='WHATSAPP'||hashValue(send.content)!==hashValue(frozen.recipientContents[enrollment.lead_id]?.[step.id]))return 'CONTENT_CHANGED';
  if((frozen.cadence.settings.stopOnReply||step.stopOnReply)&&Number(i.reply_epoch)>Number(enrollment.authorized_reply_epoch))return 'CONTACT_REPLIED';
 }else if(o.proof.leadId&&hashValue(ctx.lead)!==o.proof.leadHash)return 'LEAD_CHANGED';
 const template=ctx.template as TemplateView|null;
 if(send.content.kind==='template'){
  const expected=publication?.snapshot.templateProofs[send.content.templateId]?.hash??o.proof.templateHash;
  if(!template||template.hash!==expected)return 'TEMPLATE_CHANGED';
 }
 const policy=evaluateSendPolicy({now,lastInboundAt:ctx.lastInboundAt??null,purpose:send.purpose,hasOptIn:ctx.consents.length>0,suppressed:ctx.suppressions.length>0,senderReady:s.ready,content:send.content,template});
 return policy.blockers[0]??null;
}
