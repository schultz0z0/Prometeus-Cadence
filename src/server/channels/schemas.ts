import {z} from 'zod';
const secret=z.string().max(16384),id=z.string().regex(/^\d{1,40}$/);
const common={requestId:z.uuid(),expectedRevision:z.number().int().min(0),id:z.uuid().optional(),name:z.string().trim().min(1).max(120)};
export const saveConnectionSchema=z.discriminatedUnion('provider',[
 z.strictObject({...common,provider:z.literal('meta'),identifiers:z.strictObject({appId:id,wabaId:id,phoneNumberId:id}),credentials:z.strictObject({accessToken:secret,appSecret:secret})}),
]);
export type SaveConnectionInput=z.infer<typeof saveConnectionSchema>;
export const senderLimitsSchema=z.strictObject({requestId:z.uuid(),expectedRevision:z.number().int().min(0),workspaceDailyLimit:z.number().int().min(1).max(100000),senderId:z.uuid(),senderDailyLimit:z.number().int().min(1).max(100000),senderNewConversationLimit:z.number().int().min(1).max(100000).optional()});
export type SenderLimitsInput=z.infer<typeof senderLimitsSchema>;
export const contentSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('text'),text:z.string().min(1).max(4096)}),
 z.strictObject({kind:z.literal('template'),templateId:z.uuid(),templateRevision:z.number().int().min(1),variables:z.record(z.string().max(100),z.string().max(1024)).refine(v=>Object.keys(v).length<=100)}),
]);
