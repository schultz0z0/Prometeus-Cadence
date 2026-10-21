import type {Cadence,Lead} from './model.ts';
import type {Identity,OutboundContent,Review,SenderView} from './whatsapp.ts';
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
export interface ReconciliationSnapshot {messageId:string;attemptId:string;remoteId:string|null;resolution:'accepted'|'not_accepted';evidence:string}
