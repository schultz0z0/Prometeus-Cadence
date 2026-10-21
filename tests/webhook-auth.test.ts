import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {authenticateWebhook,verifyMetaChallenge} from '../src/server/channels/webhook-auth.ts';
import type {IngressContext} from '../src/server/channels/ingress-contracts.ts';
const ctx:IngressContext={id:'connection',workspaceId:'workspace',provider:'meta',revision:1,publicId:'public-identifier',state:'awaiting_webhook',externalAccountId:'222',identifiers:{appId:'111',wabaId:'222',phoneNumberId:'333'},senders:[{externalId:'333',address:'+5541999999999'}],credentialVersions:[{revision:1,credentials:{appSecret:'fixture-app-secret',accessToken:'fixture-access-token',verifyToken:'fixture-verify'}}]};
const body=JSON.stringify({object:'whatsapp_business_account',entry:[{id:'222',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:'333'},messages:[{id:'wamid.fixture',from:'5541988888888',timestamp:'1792580400',type:'text',text:{body:'Olá'}}]}}]}]});
const metaReq=(text=body,secret='fixture-app-secret')=>new Request('http://internal/api/channel-webhooks/meta/public-identifier',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(text).digest('hex')},body:text});
test('Meta authenticates raw bytes and asset scope before producing a normalized batch',async()=>{
 const deps={lookup:async()=>ctx,now:()=>new Date('2026-10-21T11:00:00Z').toISOString()};
 const batch=await authenticateWebhook(metaReq(),'public-identifier','meta',deps);
 assert.equal(batch.events[0].kind,'inbound');assert.equal(batch.connectionId,'connection');assert.equal(batch.events[0].senderExternalId,'333');
 await assert.rejects(authenticateWebhook(metaReq(body,'wrong'),'public-identifier','meta',deps),{status:403});
 await assert.rejects(authenticateWebhook(metaReq(body.replace('222','999')),'public-identifier','meta',deps),{status:403});
 await assert.rejects(authenticateWebhook(metaReq(body.replace('333','999')),'public-identifier','meta',deps),{status:403});
 await assert.rejects(authenticateWebhook(metaReq('x'.repeat(1048577)),'public-identifier','meta',deps),{status:413});
 const challenge=await verifyMetaChallenge(new Request('http://internal/path?hub.mode=subscribe&hub.verify_token=fixture-verify&hub.challenge=123'),'public-identifier',{...deps,markChallenge:async()=>{}});assert.equal(challenge,'123');
});
test('Twilio signs the canonical external URL and every parameter; proxy headers cannot change validation',async()=>{
 process.env.CHANNEL_PUBLIC_BASE_URL='https://hooks.example';const account='AC'+'a'.repeat(32),canonical='https://hooks.example/api/channel-webhooks/twilio/public-identifier/messages';
 const params={AccountSid:account,MessageSid:'SM'+'b'.repeat(32),From:'whatsapp:+5541988888888',To:'whatsapp:+5541999999999',Body:'Olá',FutureField:'must be signed'};
 const signature=(url:string)=>createHmac('sha1','fixture-auth').update(url+Object.keys(params).sort().map(k=>k+params[k as keyof typeof params]).join('')).digest('base64');
 const context:IngressContext={...ctx,provider:'twilio',externalAccountId:account,identifiers:{accountSid:account,sender:'+5541999999999',authMode:'api-key'},senders:[{externalId:'XE'+'c'.repeat(32),address:'+5541999999999'}],credentialVersions:[{revision:1,credentials:{authToken:'fixture-auth'}}]};
 const req=(sig:string)=>new Request('http://internal/api/channel-webhooks/twilio/public-identifier/messages',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':sig,'x-forwarded-host':'evil.example'},body:new URLSearchParams(params)});
 const deps={lookup:async()=>context};const result=await authenticateWebhook(req(signature(canonical)),'public-identifier','twilio-messages',deps);assert.equal(result.events[0].kind,'inbound');assert.equal(result.events[0].occurredAt,null);
 await assert.rejects(authenticateWebhook(req(signature('https://evil.example/api/channel-webhooks/twilio/public-identifier/messages')),'public-identifier','twilio-messages',deps),{status:403});
 await assert.rejects(authenticateWebhook(req(signature(canonical)),'public-identifier','twilio-messages',{lookup:async()=>({...context,externalAccountId:'other'})}),{status:403});
});
