import {z} from 'zod';
import {normalizeMailAddress} from '../../domain/mail-policy.ts';
const host=z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9.-]+$/),secret=z.string().max(16384);
const address=z.string().refine(value=>{try{normalizeMailAddress(value);return true;}catch{return false;}}).transform(normalizeMailAddress);
const common={requestId:z.uuid(),id:z.uuid().optional(),expectedRevision:z.number().int().min(0),name:z.string().trim().min(1).max(120),signature:z.string().refine(v=>Buffer.byteLength(v)<=4096)};
export const mailboxSaveSchema=z.discriminatedUnion('provider',[
 z.strictObject({...common,provider:z.literal('smtp-imap'),address,config:z.strictObject({smtpHost:host,smtpPort:z.union([z.literal(465),z.literal(587)]),imapHost:host,imapPort:z.literal(993),smtpUser:z.string().min(1).max(254),imapUser:z.string().min(1).max(254),inbox:z.string().min(1).max(200),sentFolder:z.string().min(1).max(200).nullable()}),credentials:z.strictObject({smtpPassword:secret,imapPassword:secret})}),
 z.strictObject({...common,provider:z.literal('gmail'),config:z.strictObject({}),credentials:z.strictObject({})}),
]);
export const mailboxActionSchema=z.strictObject({id:z.uuid(),expectedRevision:z.number().int().min(1),requestId:z.uuid()});
export type MailboxSaveInput=z.infer<typeof mailboxSaveSchema>;
