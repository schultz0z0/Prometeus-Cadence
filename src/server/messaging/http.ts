import {channelHttp} from '../channels/request.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {connectionRow} from '../channels/repository.ts';
import {readMessagingLimits} from '../channels/limits.ts';
import {AppError} from '../errors.ts';
import {listConversations,readConversation,markConversationRead,linkConversationLead} from './inbox.ts';
import {recordConsent,recordLeadConsent,suppressIdentity} from './consent.ts';
import {preparePublication,confirmPublication,listPublications,pausePublication} from './publication.ts';
import {prepareReply,confirmReply} from './replies.ts';
import {prepareReconciliation,confirmReconciliation} from './reconciliation.ts';
import {readMessageUsage} from './usage.ts';
export function messagingRequestHandler(request:Request,params:Record<string,string>):Promise<Response>{return channelHttp(request,async(p,body)=>{
 const {resource,id,action}=params,url=new URL(request.url);
 if(request.method==='GET'){
  if(resource==='conversations'&&!id)return listConversations(p,{...(url.searchParams.get('search')?{search:url.searchParams.get('search')!}:{}),...(url.searchParams.get('cursor')?{cursor:url.searchParams.get('cursor')!}:{}),...(url.searchParams.get('senderId')?{senderId:url.searchParams.get('senderId')!}:{})});
  if(resource==='conversations'&&action==='messages')return readConversation(p,id,url.searchParams.get('cursor')??undefined);
  if(resource==='publications'&&!id)return listPublications(p);
  if(resource==='limits'&&!id)return readMessagingLimits(p);
  if(resource==='usage'&&!id)return readMessageUsage(p);
  if(resource==='templates'&&!id){const connectionId=url.searchParams.get('connectionId');if(!connectionId)throw new AppError(422,'Escolha uma conexão.');return withWorkspaceTransaction(p,async c=>{await connectionRow(c,connectionId);return (await c.query('SELECT payload FROM app.channel_remote_template WHERE connection_id=$1 ORDER BY id',[connectionId])).rows.map(r=>r.payload);});}
 }
 if(request.method==='POST'){
  if(!id){
   if(resource==='consents')return recordConsent(p,body);if(resource==='lead-consents')return recordLeadConsent(p,body);if(resource==='suppressions')return suppressIdentity(p,body);
   if(resource==='publication-prepare')return preparePublication(p,body);if(resource==='publication-confirm')return confirmPublication(p,body);
  }
  if(resource==='conversations'){
   if(action==='read')return markConversationRead(p,id,body);if(action==='link-lead')return linkConversationLead(p,id,body);if(action==='reply-prepare')return prepareReply(p,id,body);if(action==='reply-confirm')return confirmReply(p,id,body);
  }
  if(resource==='publications'&&action==='pause')return pausePublication(p,{...(body as Record<string,unknown>),publicationId:id});
  if(resource==='messages'&&action==='reconciliation-prepare')return prepareReconciliation(p,id,body);
  if(resource==='messages'&&action==='reconciliation-confirm')return confirmReconciliation(p,{...(body as Record<string,unknown>),messageId:id});
 }
 throw new AppError(404,'Recurso ou ação não encontrada.');
});}
