export interface OperationEvent {
 sequence:string;kind:'job'|'automation'|'channel'|'sender'|'mailbox'|'message'|'outbox'|'billing';
 entityId:string;state:string;revision:string;recordedAt:string;
}
export interface OperationEventsPage {items:OperationEvent[];nextCursor:string;hasMore:boolean}
