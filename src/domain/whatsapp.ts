export type Provider='meta'|'openwa'|'twilio';
export type ConnectableProvider='meta'|'openwa';
export type ConnectionState='pending'|'credentials_verified'|'awaiting_webhook'|'ready'|'attention'|'disconnected';
export interface ConnectionView {
 id:string;provider:Provider;name:string;revision:number;state:ConnectionState;
 externalAccountId:string|null;hasSecrets:boolean;
 verification:{credentials:boolean;challenge:boolean;inbound:boolean};senders:SenderView[];
 callbackUrl?:string|null;lastError?:string|null;tokenExpiresAt?:string|null;
 identifiers?:Record<string,string>;callbackStatusUrl?:string|null;callbackPath?:string;
}
export interface SenderView {id:string;connectionId:string;provider:Provider;address:string|null;externalId:string;identityScope:string;revision:number;ready:boolean;dailyLimit:number|null;newConversationLimit?:number|null}
export interface Identity {scope:string;externalId:string;phone:string|null}
export interface TemplateParameter {component:'header'|'body'|'button';key:string;type:'text'|'currency'|'date_time'|'media';buttonIndex?:number}
export interface TemplateComponent {type:'header'|'body'|'footer'|'button';text:string;buttonIndex?:number}
export type TemplateStatus='approved'|'pending'|'rejected'|'paused'|'disabled'|'unknown';
export interface TemplateView {id:string;connectionId:string;provider:Provider;remoteId:string;name:string;language:string;status:TemplateStatus;revision:number;hash:string;parameters:TemplateParameter[];components:TemplateComponent[]}
export type OutboundContent={kind:'text';text:string}|{kind:'template';templateId:string;templateRevision:number;variables:Record<string,string>};
export interface ConsentInput {identityId:string;purpose:string;source:string;occurredAt:string;evidence:string}
export type MessagePurpose='service'|'campaign'|'test';
export interface SendPolicyInput {provider:Provider;now:string;lastInboundAt:string|null;purpose:MessagePurpose;hasOptIn:boolean;suppressed:boolean;senderReady:boolean;content:OutboundContent;template:TemplateView|null}
export interface SendPolicyResult {allowed:boolean;blockers:string[]}
export interface Review<T> {token:string;expiresAt:string;snapshot:T;blockers:string[]}
export interface PreparedSend {connectionId:string;connectionRevision:number;senderId:string;identity:Identity;content:OutboundContent;purpose:MessagePurpose;traceId?:string}
export type SendOutcome={kind:'accepted';remoteId:string;acceptedAt:string;evidence?:{accountId:string;from:string;to:string;status?:'sent'|'delivered'|'read'|'failed'|'unknown'}}|{kind:'not_accepted';code:string;retryable:boolean;retryAfterMs:number|null}|{kind:'uncertain';code:string};
export interface Receipt {attemptId:string;outcome:SendOutcome;costUsd:number|null;costKind:'reported'|'unknown'}
interface EventBase {dedupKey:string;accountId:string;senderExternalId:string|null;occurredAt:string|null}
export type WebhookEvent=EventBase&(
 {kind:'inbound';remoteId:string;identity:Identity;text:string|null;mediaKind:string|null}|
 {kind:'status';remoteId:string;status:string;errorCode:string|null;traceId?:string}|
 {kind:'template';remoteId:string;status:TemplateStatus}|
 {kind:'session';phase:string;restricted:boolean;restrictionCode:string|null}|
 {kind:'unknown';eventType:string}
);
export interface AuthenticatedBatch {connectionId:string;credentialRevision:number;bodyHash:string;receivedAt:string;events:WebhookEvent[]}
export type MessageState='received'|'pending'|'dispatching'|'accepted'|'delivered'|'read'|'failed'|'uncertain'|'cancelled'|'blocked';
export interface MessageView {id:string;conversationId:string;direction:'inbound'|'outbound';text:string|null;mediaKind:string|null;state:MessageState;remoteId:string|null;createdAt:string}
export interface ConversationView {id:string;senderId:string;identityId:string;identity:Identity;leadId:string|null;unread:number;lastMessageAt:string|null}
export interface DispatchLease {workspaceId:string;messageId:string;attemptId:string;token:string;fence:number;expiresAt:string}
