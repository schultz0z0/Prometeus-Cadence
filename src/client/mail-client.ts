import type {MailboxView,MailContent,MailSend} from '../domain/mail.ts';
import type {Review,MessageView,OutboundContent} from '../domain/whatsapp.ts';
import type {Cadence} from '../domain/model.ts';
import type {PublicationInputV2,PublicationReviewV2,PublicationView,VersionedPublicationSnapshot} from '../domain/cadence-runtime.ts';
import type {MailboxSaveInput} from '../server/mail/schemas.ts';
import type {SmtpImapConfig} from '../server/mail/contracts.ts';
import {createWorkspaceTransport,type WorkspaceTransportOptions} from './workspace-transport.ts';
import {createReviewedCommands} from './channel-client.ts';
export interface MailDetail {mailbox:MailboxView;config:SmtpImapConfig|Record<string,never>;senderRevision:number;limits:{revision:number;workspaceDailyLimit:number|null;timezone:string};channelLimits:{revision:number;dailyLimit:number;minIntervalSeconds:number;maxIntervalSeconds:number}|null;bouncePaused:boolean;syncGap:boolean;oauthConfigured:boolean}
export type MailTestInput={messageId:string;expectedRevision:number;mode:'proof'}|{messageId:string;expectedRevision:number;mode:'test';to:string;content:MailContent;consent:{source:string;occurredAt:string;evidence:string}};
export interface MailTestPrepared {mailboxId:string;input:MailTestInput;review:Review<MailSend>&{preview:string;material:string}}
export interface PublicationPreparedV2 {input:PublicationInputV2;review:PublicationReviewV2}
export interface MailReplyInput {messageId:string;content:MailContent}
export interface MailReplyPrepared {conversationId:string;input:MailReplyInput;review:Review<MailSend>&{preview:string}}
export interface MailLimitsInput {expectedRevision:number;limitsRevision:number;channelRevision:number;workspaceDailyLimit:number;channelDailyLimit:number;senderDailyLimit:number;minIntervalSeconds:number;maxIntervalSeconds:number}
export interface MailDiagnostics {spf:'observed'|'missing'|'unverified';dkim:'observed'|'missing'|'unverified';dmarc:'observed'|'missing'|'unverified';alignment:'unverified';notes:string[]}
type WithoutRequest<T>=T extends unknown?Omit<T,'requestId'>:never;
export type MailboxSaveCommand=WithoutRequest<MailboxSaveInput>;
export function buildPublicationInputV2(cadence:Cadence,revision:number,leadIds:string[],steps:Record<string,{senderId:string;content:MailContent|OutboundContent}>):PublicationInputV2{
 if(cadence.steps.some(step=>!steps[step.id]?.senderId))throw Error('Escolha o remetente de cada etapa.');
 return {version:2,cadenceId:cadence.id,expectedRevision:revision,leadIds:[...leadIds],steps:Object.fromEntries(cadence.steps.map(step=>[step.id,structuredClone(steps[step.id])]))};
}
export function createMailClient(options:WorkspaceTransportOptions){
 const api=createWorkspaceTransport(options),commands=createReviewedCommands(api),root='/api/mailboxes',path=(id:string,action?:string)=>root+'/'+encodeURIComponent(id)+(action?'/'+action:'');
 const action=<T>(id:string,name:string,input:{expectedRevision:number})=>commands.run<T>(input,path(id,name),{...input});
 return {
  list:()=>api.request<MailboxView[]>(root),detail:(id:string)=>api.request<MailDetail>(path(id)),
  save:(input:MailboxSaveCommand)=>commands.run<MailboxView>(input,root,input),
  startAuthorization:(id:string,input:{expectedRevision:number})=>action<{authorizationUrl:string;expiresAt:string}>(id,'authorize',input),
  verify:(id:string,input:{expectedRevision:number})=>action<MailboxView>(id,'verify',input),
  sync:(id:string,input:{expectedRevision:number})=>action<MailDetail>(id,'sync',input),
  disconnect:(id:string,input:{expectedRevision:number})=>action<MailboxView>(id,'disconnect',input),
  limits:(id:string,input:MailLimitsInput)=>commands.run<{saved:true}>(input,path(id,'limits'),{...input}),
  resume:(id:string,input:{expectedRevision:number;acknowledge:true;reason:string})=>commands.run<{reviewed:true}>(input,path(id,'resume'),input),
  diagnose:(id:string,selector?:string)=>api.request<MailDiagnostics>(path(id,'diagnostics')+(selector?'?selector='+encodeURIComponent(selector):'')),
  async prepareTest(mailboxId:string,input:MailTestInput):Promise<MailTestPrepared>{const copy=structuredClone(input);return {mailboxId,input:copy,review:await api.request(path(mailboxId,'test-prepare'),copy)};},
  confirmTest:(prepared:MailTestPrepared)=>commands.run<MessageView>(prepared,path(prepared.mailboxId,'test-confirm'),{...prepared.input,reviewToken:prepared.review.token,material:prepared.review.material}),
  async preparePublication(input:PublicationInputV2):Promise<PublicationPreparedV2>{const copy=structuredClone(input);return {input:copy,review:await api.request('/api/messaging/publication-prepare',copy)};},
  confirmPublication:(prepared:PublicationPreparedV2)=>commands.run<PublicationView>(prepared,'/api/messaging/publication-confirm',{...prepared.input,reviewToken:prepared.review.token,material:prepared.review.material}),
  readPublication:(id:string)=>api.request<{publication:PublicationView;snapshot:VersionedPublicationSnapshot}>('/api/messaging/publications/'+encodeURIComponent(id)),
  recordConsent:(input:{leadId:string;address:string;purpose:'campaign'|'test';source:string;occurredAt:string;evidence:string})=>commands.run<void>(input,'/api/messaging/email-consents',input),
  async prepareReply(conversationId:string,input:MailReplyInput):Promise<MailReplyPrepared>{const copy=structuredClone(input);return {conversationId,input:copy,review:await api.request('/api/messaging/conversations/'+encodeURIComponent(conversationId)+'/reply-prepare',copy)};},
  confirmReply:(prepared:MailReplyPrepared)=>commands.run<MessageView>(prepared,'/api/messaging/conversations/'+encodeURIComponent(prepared.conversationId)+'/reply-confirm',{...prepared.input,reviewToken:prepared.review.token}),
  dispose(){api.dispose();commands.clear();},
 };
}
export type MailClient=ReturnType<typeof createMailClient>;
