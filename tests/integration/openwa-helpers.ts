import {randomUUID} from 'node:crypto';import {readFileSync} from 'node:fs';
import {whatsappUser,testAdmin} from './whatsapp-helpers.ts';
export {whatsappUser,testAdmin};
export const openwaInput=()=>({requestId:randomUUID(),name:'QA own WhatsApp'});
export async function openwaFixture(){
 const u=await whatsappUser();const {createOpenwaRecord}=await import('../../src/server/channels/openwa/repository.ts');
 const input=openwaInput(),view=await createOpenwaRecord(u.p,input);
 return {u,input,view,id:view.connection.id};
}
export function openwaGatewayDouble(lostStages:string[]=[]){
 const template=JSON.parse(readFileSync(new URL('../fixtures/openwa/session.json',import.meta.url),'utf8'));
 const qr=JSON.parse(readFileSync(new URL('../fixtures/openwa/qr.json',import.meta.url),'utf8'));
 const lost=new Set(lostStages),realFetch=fetch;
 const gateway={session:null as any,keys:[] as any[],hooks:[] as any[],paired:false,expireQr:false,creates:0,keyCreates:0,hookCreates:0,starts:0,stops:0,onStart:null as null|(()=>Promise<void>),fetch:undefined as unknown as typeof fetch};
 const fail=(stage:string)=>{if(lost.delete(stage))throw Error('Fixture response lost after side effect');};
 gateway.fetch=async(url,init)=>{
  const target=new URL(String(url));if(target.origin!=='http://127.0.0.1:2785')return realFetch(url,init);
  const method=init?.method??'GET',body=init?.body?JSON.parse(String(init.body)):null;
  if(target.pathname==='/api/sessions'&&method==='GET')return Response.json(gateway.session?[gateway.session]:[]);
  if(target.pathname==='/api/sessions'&&method==='POST'){gateway.creates++;gateway.session={...template,id:randomUUID(),name:body.name,status:'created',phone:null,engineLoaded:false};fail('session');return Response.json(gateway.session,{status:201});}
  if(target.pathname==='/api/auth/api-keys'&&method==='GET')return Response.json(gateway.keys);
  if(target.pathname==='/api/auth/api-keys'&&method==='POST'){gateway.keyCreates++;const key={id:randomUUID(),...body,isActive:true};gateway.keys.push(key);fail('key');return Response.json({...key,apiKey:'fixture-operational-key'});}
  if(target.pathname.startsWith('/api/auth/api-keys/')&&method==='DELETE'){gateway.keys=gateway.keys.filter(k=>k.id!==target.pathname.split('/').at(-1));return new Response(null,{status:204});}
  if(target.pathname.endsWith('/webhooks')&&method==='GET')return Response.json(gateway.hooks);
  if(target.pathname.endsWith('/webhooks')&&method==='POST'){gateway.hookCreates++;const hook={id:randomUUID(),url:body.url,events:body.events,active:true};gateway.hooks.push(hook);fail('webhook');return Response.json(hook);}
  if(/\/webhooks\/[^/]+$/.test(target.pathname)&&method==='PUT'){const hook=gateway.hooks.find(h=>h.id===target.pathname.split('/').at(-1));Object.assign(hook,{url:body.url,events:body.events,active:true});return Response.json(hook);}
  if(target.pathname.endsWith('/start')){gateway.starts++;gateway.session={...gateway.session,status:'qr_ready',engineLoaded:true};await gateway.onStart?.();fail('start');return Response.json(gateway.session);}
  if(target.pathname.endsWith('/stop')){gateway.stops++;gateway.session={...gateway.session,status:'disconnected',engineLoaded:false};return Response.json(gateway.session);}
  if(target.pathname.endsWith('/qr'))return gateway.expireQr?Response.json({code:'QR_NOT_READY'},{status:400}):Response.json(qr);
  if(target.pathname.endsWith('/logout')){gateway.paired=false;gateway.session={...gateway.session,status:'disconnected',phone:null,engineLoaded:false};return Response.json(gateway.session);}
  if(target.pathname===`/api/sessions/${gateway.session?.id}`)return Response.json({...gateway.session,...(gateway.paired?{status:'ready',phone:'15550000001'}:{})});
  throw Error('Unexpected gateway fixture request');
 };
 return gateway;
}
