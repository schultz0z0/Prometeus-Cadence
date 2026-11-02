import {z} from 'zod';
// Lead events the product emits today; agent events belong to the SDR agent (07B) and are not offered yet.
export const webhookEvents=['lead.created','lead.qualified','lead.connected','lead.connected.email','lead.connected.whatsapp'] as const;
export type WebhookEvent=(typeof webhookEvents)[number];
export const webhookEventLabels:Record<WebhookEvent,string>={'lead.created':'Lead entrou na base','lead.qualified':'Lead qualificado pela IA','lead.connected':'Lead respondeu','lead.connected.email':'Resposta por e-mail','lead.connected.whatsapp':'Resposta por WhatsApp'};
export const agentEvents=[['agent.qualified','O agente de IA qualificou o lead'],['agent.meeting_booked','O agente de IA marcou uma reunião'],['agent.handoff','O agente passou a conversa para a equipe'],['agent.disqualified','O agente descartou o lead ou o lead pediu para parar']] as const;
export const MAX_DESTINATIONS=10;
export interface WebhookView{id:string;name:string;url:string;events:WebhookEvent[];listIds:string[]|null;active:boolean;state:'ok'|'attention';attention:string|null;secretConfigured:boolean;revision:number;consecutiveFailures:number;lastSuccessAt:string|null;deliveries:number}
export interface DeliveryView{id:string;eventType:string;state:'pending'|'delivering'|'delivered'|'failed'|'held'|'cancelled';attempts:number;lastStatus:number|null;lastError:string|null;createdAt:string;deliveredAt:string|null;nextAt:string|null}
export interface IntegrationEnvelope{id:string;idempotencyKey:string;type:string;version:1;occurredAt:string;sentAt:string;entity:{kind:string;id:string};data:Record<string,unknown>}
export const webhookInputSchema=z.strictObject({
 name:z.string().trim().min(1).max(80),
 url:z.string().trim().max(2000).refine(v=>{try{return['https:','http:'].includes(new URL(v).protocol);}catch{return false;}}),
 events:z.array(z.enum(webhookEvents)).min(1).max(webhookEvents.length).refine(v=>new Set(v).size===v.length),
 lists:z.discriminatedUnion('mode',[z.strictObject({mode:z.literal('all')}),z.strictObject({mode:z.literal('specific'),ids:z.array(z.string().min(1).max(120)).min(1).max(50)})]),
 secret:z.string().trim().min(16).max(200).optional(),
 expectedRevision:z.number().int().min(0),
});
export type WebhookInput=z.infer<typeof webhookInputSchema>;
// Only rate limits, server errors and network failures are transient; a refused credential needs a person, not a loop.
export function webhookRetryAllowed(input:{status:number;attempt:number;ageHours:number}){
 const transient=input.status===0||input.status===429||input.status>=500;
 return transient&&input.attempt<6&&input.ageHours<24;
}
const schedule=[60e3,300e3,1800e3,7200e3,21600e3],window=24*3600e3;
export function nextRetryDelay(input:{attempt:number;ageMs:number;retryAfterMs?:number}):number|null{
 const base=schedule[input.attempt-1];if(base===undefined)return null;
 const delay=Math.max(base,input.retryAfterMs??0);
 return input.ageMs+delay<window?delay:null;
}
export function parseRetryAfter(value:string|undefined,now:number):number|undefined{
 if(!value)return undefined;
 if(/^\d{1,9}$/.test(value.trim()))return Number(value.trim())*1000;
 const at=Date.parse(value);return Number.isFinite(at)&&at>now?at-now:undefined;
}
// A destination receives an event when it subscribed to the type (or the reply's channel) and to the lead's list.
export function deliveryFor(d:{events:string[];listIds:string[]|null},e:{type:string;channel?:string;listId?:string|null}){
 const typed=d.events.includes(e.type)||(e.type==='lead.connected'&&d.events.includes('lead.connected.'+(e.channel??'').toLowerCase()));
 return typed&&(!d.listIds||(!!e.listId&&d.listIds.includes(e.listId)));
}
