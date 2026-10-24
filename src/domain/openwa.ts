import type {ConnectionView} from './whatsapp.ts';
export type OpenwaPhase='provisioning'|'qr_ready'|'authenticating'|'ready'|'disconnected'|'action_required'|'failed';
export interface OpenwaConnectionView {
 connection:ConnectionView;phase:OpenwaPhase;phone:string|null;lastCheckedAt:string|null;errorCode:string|null;
 platformDailyCap:number;platformNewConversationCap:number;
}
export interface OpenwaQrView {connectionId:string;revision:number;qrCode:string|null;phase:OpenwaPhase;refreshAfterMs:number}
export interface OpenwaCommand {requestId:string;expectedRevision:number}
export interface OpenwaMaintenanceResult {processed:number;failed:number}
export interface OpenwaTickOptions {now:string;maxConnections:number;signal?:AbortSignal}
export interface OpenwaRemoteMessage {
 gatewayId:string;remoteId:string;sessionId:string;chatId:string;fromMe:boolean;
 status:'sent'|'delivered'|'read'|'failed'|'unknown';timestamp:number|null;
}
