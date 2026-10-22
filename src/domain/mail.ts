export type MailProvider='gmail'|'smtp-imap';
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
}
export type SyncCursor={kind:'gmail';historyId:string;pageToken:string|null;watermark:string}|
 {kind:'imap';path:string;uidValidity:string;lastUid:number;watermark:string};
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
