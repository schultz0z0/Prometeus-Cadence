export type MailProvider='gmail'|'smtp-imap';
import type {ConversationView,MessageView} from './whatsapp.ts';
export interface MailContent {kind:'email';subject:string;text:string;signature:string}
export interface MailIdentity {channel:'EMAIL';scope:'email';address:string}
export type MailboxState='pending'|'authorization_required'|'verifying'|'ready'|'attention'|'disconnected';
export interface MailboxView {
 id:string;senderId:string|null;provider:MailProvider;name:string;address:string|null;revision:number;
 state:MailboxState;hasSecrets:boolean;sendVerified:boolean;readVerified:boolean;lastSyncedAt:string|null;
 syncState:'baseline'|'ready'|'recovering'|'error';dailyLimit:number|null;signature:string;lastError:string|null;
}
export interface MailMessage {
 remoteId:string;remoteThreadId:string|null;rfcMessageId:string|null;inReplyTo:string|null;references:string[];
 from:string;to:string[];subject:string;text:string;receivedAt:string;direction:'inbound'|'outbound';
 classification:'human'|'automatic'|'dsn'|'ambiguous';attachments:{name:string|null;type:string;size:number|null}[];truncated:boolean;
 headers?:Record<string,string>;deliveryStatus?:string;
 assessment?:{kind:'human'|'automatic'|'hard-bounce'|'soft-bounce'|'ambiguous';correlationId:string|null;recipient?:string;stopRequested:boolean};
}
export interface ImapFolderCursor {kind:'imap';path:string;uidValidity:string;lastUid:number;watermark:string;recovery?:{since:string}}
export type SyncCursor={kind:'gmail';historyId:string;pageToken:string|null;watermark:string;pending?:{ids:string[];historyId:string;pageToken:string|null};recovery?:{since:string;historyId:string;pageToken:string|null}}|
 (ImapFolderCursor&{sent?:ImapFolderCursor});
export interface SyncBatch {messages:MailMessage[];next:SyncCursor;complete:boolean;gap:boolean}
export interface MailSend {
 connectionId:string;connectionRevision:number;senderId:string;address:string;to:string;content:MailContent;
 rfcMessageId:string;thread:{remoteThreadId:string|null;inReplyTo:string|null;references:string[]}|null;
 purpose:'campaign'|'service'|'test';unsubscribeUrl:string|null;
}
export interface SyncLease {workspaceId:string;mailboxId:string;token:string;fence:number;revision:number;expiresAt:string}
export interface MailPolicyInput {
 purpose:MailSend['purpose'];authorized:boolean;suppressed:boolean;hasInbound:boolean;sendReady:boolean;
 syncState:MailboxView['syncState'];lastSyncedAt:string|null;now:string;
}
export interface EmailConversationView extends ConversationView {channel:'EMAIL';mail:{mailboxId:string;mailboxName:string;mailboxAddress:string;subject:string;needsReview:boolean}}
export interface EmailMessageView extends MessageView {channel:'EMAIL';mail:{subject:string;from:string;to:string[];origin:'app'|'external';classification:MailMessage['classification'];attachments:MailMessage['attachments'];truncated:boolean;rfcMessageId:string|null;inReplyTo:string|null;references:string[]}}
export interface EmailThreadView {channel:'EMAIL';conversation:EmailConversationView;messages:EmailMessageView[];nextCursor:string|null}
