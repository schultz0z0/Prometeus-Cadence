export interface DeliveryEvidence {
 messageId:string;state:string;acceptedAt:string|null;deliveredAt:string|null;readAt:string|null;
 supported:('accepted'|'delivered'|'read')[];
}
// The message is already queued by the existing reviewed test flow. Observation never sends.
export interface ChannelPilotInput {
 connectionId:string;messageId:string;ownedRecipient:string;reviewToken:string;requestId:string;
}
export interface PilotAdapters {observe:(remoteId:string)=>Promise<DeliveryEvidence>}
export interface PilotResult {
 outboundId:string;inboundId:string|null;delivery:DeliveryEvidence;stoppedEnrollment:boolean;
}
export function classifyDeliveryProof(input:{accepted:boolean;delivered:boolean|null;read:boolean|null}):'pending'|'accepted'|'delivered'|'read'{
 return input.read===true?'read':input.delivered===true?'delivered':input.accepted?'accepted':'pending';
}
