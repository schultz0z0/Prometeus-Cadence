import {z} from 'zod';
import type {SyncBatch} from '../../../domain/mail.ts';
const date=z.string().refine(v=>Number.isFinite(Date.parse(v))),nullable=z.string().max(1000).nullable();
const cursor=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('gmail'),historyId:z.string().regex(/^\d{1,40}$/),pageToken:z.string().max(8192).nullable(),watermark:date,recovery:z.strictObject({since:date,historyId:z.string().regex(/^\d{1,40}$/),pageToken:z.string().max(8192).nullable()}).optional()}),
 z.object({kind:z.literal('imap'),path:z.string().min(1).max(200),uidValidity:z.string().regex(/^\d{1,40}$/),lastUid:z.number().int().min(0).max(4294967295),watermark:date,recovery:z.strictObject({since:date}).optional()}),
]);
const schema=z.strictObject({messages:z.array(z.object({remoteId:z.string().min(1).max(1000),remoteThreadId:nullable,rfcMessageId:nullable,inReplyTo:nullable,references:z.array(z.string().max(1000)).max(100),from:z.string().max(254),to:z.array(z.string().max(254)).max(100),subject:z.string().max(1000),text:z.string().refine(v=>new TextEncoder().encode(v).length<=65536),receivedAt:date,direction:z.enum(['inbound','outbound']),classification:z.enum(['human','automatic','dsn','ambiguous']),attachments:z.array(z.object({name:nullable,type:z.string().max(200),size:z.number().nonnegative().nullable()})).max(100),truncated:z.boolean(),headers:z.record(z.string().max(100),z.string().max(1000)).optional(),deliveryStatus:z.string().max(8192).optional()})).max(100),next:cursor,complete:z.boolean(),gap:z.boolean()});
export function assertSyncBatch(batch:unknown):asserts batch is SyncBatch {if(!schema.safeParse(batch).success||new TextEncoder().encode(JSON.stringify(batch)).length>12582912)throw Error('EMAIL_SYNC_BATCH_INVALID');}
