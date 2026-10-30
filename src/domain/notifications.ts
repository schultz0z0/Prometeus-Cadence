import{z}from'zod';
import{localDateAt,wallTimeToUtc}from'./schedule.ts';
export const notificationEvents=['lead_reply','meeting','handoff','approval','qualified','agent_failed','job_completed','delivery_failed','integration_attention'] as const;
export const notificationPreferencesSchema=z.strictObject({expectedRevision:z.number().int().min(0),events:z.array(z.enum(notificationEvents)).max(notificationEvents.length).refine(v=>new Set(v).size===v.length),email:z.boolean(),whatsapp:z.boolean(),sound:z.boolean(),badge:z.boolean(),quiet:z.strictObject({timezone:z.string().max(100).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}}),start:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),end:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)}).nullable(),summary:z.strictObject({frequency:z.enum(['off','daily','weekly']),time:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)})});
export type NotificationPreferences=z.infer<typeof notificationPreferencesSchema>;
export type NotificationItem={id:string;eventKey:string;title:string;href:string;readAt:string|null;createdAt:string};
export type NotificationPreferenceView={revision:number;value:NotificationPreferences;destinations:{email:'verified'|'pending';whatsapp:'pending';externalDelivery:boolean}};
export type NotificationPage={items:NotificationItem[];nextCursor:string|null;unread:number;latestKey:string|null;latestAt:string|null;preferences:NotificationPreferenceView};
export const defaultNotificationPreferences:NotificationPreferences={expectedRevision:0,events:['lead_reply','job_completed','delivery_failed','integration_attention'],email:false,whatsapp:false,sound:false,badge:true,quiet:null,summary:{frequency:'off',time:'09:00'}};
export function notificationAllowed(v:{enabled:boolean;quiet:boolean;verifiedDestination:boolean}){return v.enabled&&!v.quiet&&v.verifiedDestination;}
const shift=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
export function quietUntil(now:string,q:NotificationPreferences['quiet']){
 if(!q||q.start===q.end)return null;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:q.timezone,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).format(new Date(now)),date=localDateAt(now,q.timezone);
 const quiet=q.start<q.end?parts>=q.start&&parts<q.end:parts>=q.start||parts<q.end;
 return quiet?wallTimeToUtc(q.start>q.end&&parts>=q.start?shift(date,1):date,q.end,q.timezone):null;
}
export function nextSummary(now:string,frequency:'daily'|'weekly',time:string,timezone:string){
 let date=localDateAt(now,timezone);if(frequency==='weekly'){const weekday=new Date(date+'T00:00:00Z').getUTCDay();date=shift(date,(8-weekday)%7);}
 let next=wallTimeToUtc(date,time,timezone);if(Date.parse(next)<=Date.parse(now))next=wallTimeToUtc(shift(date,frequency==='weekly'?7:1),time,timezone);return next;
}
export function summaryWindow(now:string,frequency:'daily'|'weekly',time:string,timezone:string){
 let date=localDateAt(now,timezone);if(frequency==='weekly')date=shift(date,-((new Date(date+'T00:00:00Z').getUTCDay()+6)%7));
 return{from:wallTimeToUtc(shift(date,frequency==='weekly'?-7:-1),'00:00',timezone),to:wallTimeToUtc(date,'00:00',timezone),next:nextSummary(now,frequency,time,timezone)};
}
export function notificationSound(v:{enabled:boolean;visible:boolean;activated:boolean;previous:string|null;current:string|null;latestAt:number;now:number}){return v.enabled&&v.visible&&v.activated&&v.previous!==null&&v.current!==null&&v.previous!==v.current&&v.now>=v.latestAt&&v.now-v.latestAt<30000;}
