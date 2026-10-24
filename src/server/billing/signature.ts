import {createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
export const stripeEventSchema=z.object({id:z.string().regex(/^evt_[A-Za-z0-9_]+$/).max(200),type:z.string().max(100),created:z.number().int().nonnegative(),livemode:z.literal(false),data:z.object({object:z.object({id:z.string().min(1).max(200),customer:z.union([z.string().max(200),z.object({id:z.string().max(200)})]).nullish()}).passthrough()})}).passthrough();
export type StripeEvent=z.infer<typeof stripeEventSchema>;
export function verifyStripeEvent(bytes:Uint8Array,header:string|null,secret:string,now=Math.floor(Date.now()/1000)):StripeEvent {
 if(!secret||!header||header.length>4096||bytes.byteLength>524288)throw Error('Webhook inválido.');
 const fields=header.split(',').map(s=>s.split('=')),times=fields.filter(([k])=>k==='t');
 if(times.length!==1||!/^\d{1,12}$/.test(times[0][1]??''))throw Error('Webhook inválido.');
 const t=Number(times[0][1]);if(!Number.isFinite(now)||Math.abs(now-t)>300)throw Error('Webhook expirado.');
 const expected=createHmac('sha256',secret).update(t+'.').update(bytes).digest();
 if(!fields.some(([k,v])=>k==='v1'&&/^[a-f0-9]{64}$/.test(v??'')&&timingSafeEqual(expected,Buffer.from(v,'hex'))))throw Error('Assinatura inválida.');
 let parsed:unknown;try{parsed=JSON.parse(Buffer.from(bytes).toString('utf8'));}catch{throw Error('Webhook inválido.');}
 return stripeEventSchema.parse(parsed);
}
