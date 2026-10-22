import type {ConversationView,MessageView,OutboundContent,PreparedSend,Review} from '../domain/whatsapp.ts';
import type {PublicationInput,PublicationReview,PublicationView,ReconciliationSnapshot} from '../domain/cadence-runtime.ts';
import {createWorkspaceTransport,type WorkspaceTransportOptions} from './workspace-transport.ts';
import {createReviewedCommands} from './channel-client.ts';
import type {EmailConversationView,EmailThreadView} from '../domain/mail.ts';
export interface ThreadView {conversation:ConversationView;messages:MessageView[];nextCursor:string|null}
export interface ReplyInput {content:OutboundContent}
export interface ReplyReview {conversationId:string;input:ReplyInput;review:Review<PreparedSend>&{preview:string}}
export interface PublicationPrepared {input:PublicationInput;review:PublicationReview}
export interface ReconciliationInput {resolution:'accepted'|'not_accepted';remoteId:string|null;evidence:string;reference:string;proofKind:'provider-log';verifiedByUser:true}
export interface ReconciliationPrepared {messageId:string;input:ReconciliationInput;review:Review<ReconciliationSnapshot>}
export interface LeadConsentInput {leadId:string;senderId:string;phone:string;source:string;occurredAt:string;evidence:string}
export function createMessagingClient(options:WorkspaceTransportOptions){
 const api=createWorkspaceTransport(options),commands=createReviewedCommands(api),root='/api/messaging/';
 const path=(resource:string,id:string,action:string)=>root+resource+'/'+encodeURIComponent(id)+'/'+action;
 return {
  listConversations:(query:{search?:string;senderId?:string;cursor?:string}={})=>api.request<{items:ConversationView[];nextCursor:string|null}>(root+'conversations?'+new URLSearchParams(query)),
  listEmailConversations:(query:{search?:string;senderId?:string;cursor?:string;direction?:'inbound'|'outbound'}={})=>api.request<{items:EmailConversationView[];nextCursor:string|null}>(root+'conversations?'+new URLSearchParams({...query,channel:'EMAIL'})),
  readEmailConversation:(id:string,cursor?:string)=>api.request<EmailThreadView>(path('conversations',id,'messages')+'?channel=EMAIL'+(cursor?'&cursor='+encodeURIComponent(cursor):'')),
  readConversation:(id:string,cursor?:string)=>api.request<ThreadView>(path('conversations',id,'messages')+(cursor?'?cursor='+encodeURIComponent(cursor):'')),
  markRead:(id:string,messageId:string)=>api.request<void>(path('conversations',id,'read'),{requestId:crypto.randomUUID(),messageId}),
  acknowledgeEmailThread:(id:string,input:{expectedRevision:number;lastMessageId:string;acknowledge:true;reason:string})=>commands.run<{reviewed:true}>(input,path('conversations',id,'email-review'),input),
  linkLead:(id:string,input:{leadId:string;expectedLeadId:string|null;evidence:string})=>commands.run<ConversationView>(input,path('conversations',id,'link-lead'),input),
  recordConsent:(input:{identityId:string;purpose:'service'|'campaign'|'test';source:string;occurredAt:string;evidence:string})=>commands.run<void>(input,root+'consents',input),
  recordLeadConsent:(input:LeadConsentInput)=>commands.run<void>(input,root+'lead-consents',{...input}),
  suppressIdentity:(input:{identityId:string;scope:'all'|'service'|'campaign'|'test';reason:string})=>commands.run<void>(input,root+'suppressions',input),
  listPublications:()=>api.request<PublicationView[]>(root+'publications'),
  async preparePublication(input:PublicationInput):Promise<PublicationPrepared>{const copy=structuredClone(input);return {input:copy,review:await api.request(root+'publication-prepare',copy)};},
  confirmPublication:(p:PublicationPrepared)=>commands.run<PublicationView>(p,root+'publication-confirm',{...p.input,reviewToken:p.review.token}),
  pausePublication:(input:{publicationId:string;expectedRevision:number})=>commands.run<PublicationView>(input,path('publications',input.publicationId,'pause'),{expectedRevision:input.expectedRevision}),
  async prepareReply(conversationId:string,input:ReplyInput):Promise<ReplyReview>{const copy=structuredClone(input);return {conversationId,input:copy,review:await api.request(path('conversations',conversationId,'reply-prepare'),copy)};},
  confirmReply:(p:ReplyReview)=>commands.run<MessageView>(p,path('conversations',p.conversationId,'reply-confirm'),{...p.input,reviewToken:p.review.token}),
  async prepareReconciliation(messageId:string,input:ReconciliationInput):Promise<ReconciliationPrepared>{const copy=structuredClone(input);return {messageId,input:copy,review:await api.request(path('messages',messageId,'reconciliation-prepare'),copy)};},
  confirmReconciliation:(p:ReconciliationPrepared)=>commands.run<MessageView>(p,path('messages',p.messageId,'reconciliation-confirm'),{...p.input,reviewToken:p.review.token}),
  usage:()=>api.request<{reserved:number;consumed:number;costUsd:number|null;emailTracking:{opens:null;clicks:null;delivered:null;read:null}}>(root+'usage'),
  dispose(){api.dispose();commands.clear();},
 };
}
export type MessagingClient=ReturnType<typeof createMessagingClient>;
