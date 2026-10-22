import type {Cadence,Lead} from './model.ts';
import type {Identity,OutboundContent,Review,SenderView} from './whatsapp.ts';
import type {MailContent,MailIdentity,MailboxView} from './mail.ts';
import type {MessagingSenderView} from './messaging.ts';
export interface PublicationInput {cadenceId:string;expectedRevision:number;senderId:string;bindings:Record<string,OutboundContent>;leadIds:string[]}
export interface PublicationSnapshot {
 cadence:Cadence;draftRevision:number;
 recipients:{leadId:string;identityId:string;identity:Identity;factsHash:string}[];
 bindings:Record<string,OutboundContent>;sender:SenderView;connectionRevision:number;
 contextVersion:number;aiRouteRevision:number;workspaceDailyLimit:number;senderDailyLimit:number;actorId:string;
 recipientFacts:Record<string,Lead>;recipientContents:Record<string,Record<string,OutboundContent>>;
 messagePreviews:Record<string,Record<string,string>>;templateProofs:Record<string,{revision:number;hash:string}>;
 productId:string|null;productVersion:number|null;
}
export type PublicationReview=Review<PublicationSnapshot>;
export interface PublicationView {id:string;cadenceId:string;revision:number;state:'active'|'paused'|'completed';enrollmentCount:number}
export interface ReconciliationSnapshot {messageId:string;attemptId:string;remoteId:string|null;resolution:'accepted'|'not_accepted';evidence:string;reference:string;proofKind:'provider-log';verifiedByUser:true;verification:'administrator-evidence'|'provider-api'}
export interface PublicationInputV2 {version:2;cadenceId:string;expectedRevision:number;leadIds:string[];steps:Record<string,{senderId:string;content:MailContent|OutboundContent}>}
export interface PublicationRecipientStepV2 {
 sender:MessagingSenderView;connectionRevision:number;identityId:string;address:string;
 identity:Identity|MailIdentity;content:MailContent|OutboundContent;preview:string;
 consentIds:string[];suppressionVersion:string;replyEpoch:number;templateProof?:{revision:number;hash:string};
 unsubscribe?:{url:string;hash:string};
}
export interface PublicationSnapshotV2 {
 version:2;cadence:Cadence;draftRevision:number;actorId:string;
 recipients:{leadId:string;steps:Record<string,PublicationRecipientStepV2>}[];
 recipientFacts:Record<string,Lead>;contextVersion:number;aiRouteRevision:number;
 productId:string|null;productVersion:number|null;
 limits:{workspaceDailyLimit:number;channels:Partial<Record<'EMAIL'|'WHATSAPP',number>>;senders:Record<string,number>};
}
export type VersionedPublicationSnapshot=PublicationSnapshot|PublicationSnapshotV2;
export type PublicationReviewV2=Review<PublicationSnapshotV2>&{material:string};
export function isPublicationV2(value:unknown):value is PublicationSnapshotV2 {return !!value&&typeof value==='object'&&'version'in value&&value.version===2;}
