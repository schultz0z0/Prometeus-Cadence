import {z} from 'zod';
import type {OpenwaRemoteMessage} from '../../../domain/openwa.ts';

export const openwaId=z.string().uuid();
export const openwaRawMessageId=z.string().min(1).max(1024).regex(/^[^\s\x00-\x1f\x7f]+$/);
export const openwaSeconds=z.number().int().positive().max(253402300799);
export const openwaStatus=z.enum(['created','initializing','qr_ready','authenticating','ready','disconnected','action_required','failed']);
const instant=z.string().datetime({offset:true});
const restriction=z.object({kind:z.enum(['reachout_timelock','tos_block','proxy_block']),code:z.string().min(1).max(128),expiresAt:instant.nullish()});
const session=z.object({
 id:openwaId,name:z.string().min(3).max(50).regex(/^[a-zA-Z0-9-]+$/),status:openwaStatus,
 phone:z.string().regex(/^\d{6,15}$/).nullish(),pushName:z.string().max(256).nullish(),
 createdAt:instant,updatedAt:instant,connectedAt:instant.nullish(),lastActive:instant.nullish(),
 engineLoaded:z.boolean(),lastError:z.string().max(4096).nullish(),restriction:restriction.nullish(),
});
const png=z.string().max(262144).regex(/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/)
 .refine(value=>value.slice('data:image/png;base64,'.length).length%4===0,'Invalid PNG encoding');
const qr=z.object({qrCode:png,status:z.literal('qr_ready')});
const send=z.object({messageId:openwaRawMessageId,timestamp:openwaSeconds});
const message=z.object({id:openwaId,waMessageId:openwaRawMessageId,sessionId:openwaId,chatId:z.string().min(1).max(256),direction:z.enum(['incoming','outgoing']),status:z.enum(['pending','sent','delivered','read','failed','revoked','unknown']),timestamp:openwaSeconds.nullish(),from:z.string().max(256).optional(),to:z.string().max(256).optional(),body:z.string().max(65536).nullish(),type:z.string().max(80).optional()});

export function parseOpenwaSession(value:unknown){return session.parse(value);}
export type OpenwaSession=ReturnType<typeof parseOpenwaSession>;
export function parseOpenwaQr(value:unknown){return qr.parse(value);}
export function parseOpenwaSend(value:unknown){return send.parse(value);}
export function parseOpenwaRemoteMessage(value:unknown):OpenwaRemoteMessage {
 const parsed=message.parse(value);
 return {gatewayId:parsed.id,remoteId:parsed.waMessageId,sessionId:parsed.sessionId,chatId:parsed.chatId,fromMe:parsed.direction==='outgoing',
  status:parsed.status==='pending'||parsed.status==='revoked'?'unknown':parsed.status,timestamp:parsed.timestamp??null,from:parsed.from,to:parsed.to,body:parsed.body,type:parsed.type};
}
