import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import path from 'node:path';import {z} from 'zod';
import {parseWhatsappSmoke} from './whatsapp-smoke-options.ts';
import type {ConnectionView} from '../src/domain/whatsapp.ts';
import {contentSchema} from '../src/server/channels/schemas.ts';
process.loadEnvFile('.env.local');
const inputSchema=z.strictObject({requestId:z.uuid(),senderId:z.uuid(),phone:z.string(),content:contentSchema,consent:z.strictObject({source:z.string().min(1),occurredAt:z.iso.datetime(),evidence:z.string().min(1)})});
const artifact=path.resolve('.superpowers/whatsapp-smoke-review.json');
try{
 const options=parseWhatsappSmoke(process.env,process.argv.slice(2));
 if(!options.enabled){console.log('WhatsApp external smoke skipped. No provider calls or sends.');}
 else {
  const raw=await fs.readFile(options.inputFile,'utf8'),input=inputSchema.parse(JSON.parse(raw)),hash=createHash('sha256').update(raw).digest('hex');
  if(input.phone!==options.phone)throw Error('Recipient changed');
  async function api<T>(route:string,body?:unknown):Promise<T>{
   const response=await fetch(options.enabled?options.base+route:'',{method:body?'POST':'GET',redirect:'error',headers:{cookie:options.enabled?options.cookie:'',origin:options.enabled?options.base:'','x-cadence-workspace':options.enabled?options.workspaceId:'',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});
   if(!response.ok)throw Error('Smoke API failed');return await response.json() as T;
  }
  const connections=await api<ConnectionView[]>('/api/channels'),connection=connections.find(c=>c.id===options.connectionId);
  if(connection?.state!=='ready'||!connection.senders.some(s=>s.id===input.senderId&&s.ready))throw Error('Ready connection required');
  const route='/api/channels/'+encodeURIComponent(options.connectionId),{requestId,...body}=input;
  if(options.mode==='prepare'){
   const review=await api<{token:string;expiresAt:string;preview:string;blockers:string[]}>(route+'/test-prepare',body);
   await fs.mkdir(path.dirname(artifact),{recursive:true});await fs.writeFile(artifact,JSON.stringify({workspaceId:options.workspaceId,connectionId:options.connectionId,hash,review}),{mode:0o600});
   console.log(JSON.stringify({recipient:options.phone,preview:review.preview,blockers:review.blockers,expiresAt:review.expiresAt},null,2));console.log('Review saved locally. No message queued. Run --confirm only after reviewing.');
  }else{
   const saved=JSON.parse(await fs.readFile(artifact,'utf8'));
   if(saved.workspaceId!==options.workspaceId||saved.connectionId!==options.connectionId||saved.hash!==hash||saved.review.blockers.length||Date.parse(saved.review.expiresAt)<=Date.now())throw Error('Review changed or expired');
   const message=await api<{id:string;state:string}>(route+'/test-confirm',{...body,requestId,reviewToken:saved.review.token});
   console.log('One reviewed message queued: '+message.id+'; state: '+message.state+'. No worker was started.');
  }
 }
}catch{console.error('WhatsApp smoke stopped. Check scope, allowlist, local session, ready connection and unexpired review. No automatic repeat was initiated.');process.exitCode=1;}
