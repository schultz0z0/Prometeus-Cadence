import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import path from 'node:path';import {z} from 'zod';
import {parseEmailSmoke,validateSmokeReview} from './email-smoke-options.ts';
import type {MailTestPrepared} from '../src/client/mail-client.ts';
process.loadEnvFile('.env.local');
const schema=z.strictObject({requestId:z.uuid(),messageId:z.uuid(),expectedRevision:z.number().int().min(1),to:z.string().max(254),content:z.strictObject({kind:z.literal('email'),subject:z.string().max(200),text:z.string().max(65536),signature:z.string().max(4096)}),consent:z.strictObject({source:z.string().min(1),occurredAt:z.iso.datetime(),evidence:z.string().min(1)})});
try{
 const options=parseEmailSmoke(process.env,process.argv.slice(2));if(!options.enabled){console.log('Email smoke skipped. No provider calls or messages queued.');}
 else{
  const raw=await fs.readFile(options.inputFile,'utf8'),input=schema.parse(JSON.parse(raw)),hash=createHash('sha256').update(raw).digest('hex');if(input.to!==options.to)throw Error('Recipient changed');
  const artifact=path.resolve('.superpowers/email-smoke-'+createHash('sha256').update(options.workspaceId+options.mailboxId).digest('hex').slice(0,24)+'.json');
  const api=async<T>(action:string,body:unknown):Promise<T>=>{const response=await fetch(options.base+'/api/mailboxes/'+encodeURIComponent(options.mailboxId)+'/'+action,{method:'POST',redirect:'error',headers:{cookie:options.cookie,origin:options.base,'x-cadence-workspace':options.workspaceId,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});if(!response.ok)throw Error('Smoke API rejected');return await response.json() as T;};
  const {requestId,...body}=input,expected={workspaceId:options.workspaceId,mailboxId:options.mailboxId,hash,requestId};
  if(options.mode==='prepare'){
   const review=await api<MailTestPrepared['review']>('test-prepare',{...body,mode:'test'});await fs.mkdir(path.dirname(artifact),{recursive:true});await fs.writeFile(artifact,JSON.stringify({...expected,review}),{mode:0o600});console.log(JSON.stringify({preview:review.preview,blockers:review.blockers,expiresAt:review.expiresAt}));console.log('Review saved locally. No message queued. Confirm only after review.');
  }else{const saved=JSON.parse(await fs.readFile(artifact,'utf8'));validateSmokeReview(saved,expected,Date.now());const result=await api<{id:string;state:string}>('test-confirm',{...body,mode:'test',requestId,reviewToken:saved.review.token,material:saved.review.material});console.log('One reviewed email queued: '+result.id+'; state: '+result.state+'. No worker started.');}
 }
}catch{console.error('Email smoke stopped. Check scope, local session, allowlist and unexpired review. No automatic repeat was initiated.');process.exitCode=1;}
