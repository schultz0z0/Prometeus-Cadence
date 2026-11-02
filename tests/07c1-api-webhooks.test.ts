import test from 'node:test';
import assert from 'node:assert/strict';
import {webhookRetryAllowed,nextRetryDelay,parseRetryAfter,webhookInputSchema,deliveryFor,webhookEvents} from '../src/domain/integration-delivery.ts';

test('07C.1 rejected credentials need intervention, not endless retries',()=>{
 assert.equal(webhookRetryAllowed({status:401,attempt:2,ageHours:1}),false);
 assert.equal(webhookRetryAllowed({status:403,attempt:1,ageHours:0}),false);
 assert.equal(webhookRetryAllowed({status:400,attempt:1,ageHours:0}),false);
 assert.equal(webhookRetryAllowed({status:302,attempt:1,ageHours:0}),false);
 assert.equal(webhookRetryAllowed({status:429,attempt:1,ageHours:1}),true);
 assert.equal(webhookRetryAllowed({status:503,attempt:5,ageHours:10}),true);
 assert.equal(webhookRetryAllowed({status:0,attempt:1,ageHours:0}),true);
 assert.equal(webhookRetryAllowed({status:500,attempt:6,ageHours:1}),false);
 assert.equal(webhookRetryAllowed({status:500,attempt:1,ageHours:24}),false);
});

test('07C.1 retry schedule 1m/5m/30m/2h/6h, Retry-After honored and capped at 24h from the event',()=>{
 assert.deepEqual([1,2,3,4,5].map(a=>nextRetryDelay({attempt:a,ageMs:0})),[60e3,300e3,1800e3,7200e3,21600e3]);
 assert.equal(nextRetryDelay({attempt:6,ageMs:0}),null);
 assert.equal(nextRetryDelay({attempt:1,ageMs:0,retryAfterMs:900e3}),900e3);
 assert.equal(nextRetryDelay({attempt:1,ageMs:0,retryAfterMs:10e3}),60e3);
 assert.equal(nextRetryDelay({attempt:5,ageMs:23*3600e3}),null);
 assert.equal(nextRetryDelay({attempt:1,ageMs:0,retryAfterMs:30*3600e3}),null);
 const now=Date.UTC(2026,10,2,12);
 assert.equal(parseRetryAfter('120',now),120e3);assert.equal(parseRetryAfter(new Date(now+600e3).toUTCString(),now),600e3);
 assert.equal(parseRetryAfter('lixo',now),undefined);assert.equal(parseRetryAfter(undefined,now),undefined);assert.equal(parseRetryAfter('-5',now),undefined);
});

test('07C.1 destination input is bounded and events are a closed list; delivery matching respects events and lists',()=>{
 const base={name:'CRM',url:'https://crm.example.com/hook',events:['lead.created'],lists:{mode:'all'},expectedRevision:0};
 assert.equal(webhookInputSchema.safeParse(base).success,true);
 assert.equal(webhookInputSchema.safeParse({...base,events:[]}).success,false);
 assert.equal(webhookInputSchema.safeParse({...base,events:['agent.qualified']}).success,false);
 assert.equal(webhookInputSchema.safeParse({...base,url:'ftp://x.example.com'}).success,false);
 assert.equal(webhookInputSchema.safeParse({...base,lists:{mode:'specific',ids:[]}}).success,false);
 assert.equal(webhookInputSchema.safeParse({...base,secret:'x'.repeat(201)}).success,false);
 assert.ok(webhookEvents.includes('lead.connected.whatsapp'));
 const d={events:['lead.connected.email'],listIds:null};
 assert.equal(deliveryFor(d,{type:'lead.connected',channel:'EMAIL',listId:'a'}),true);
 assert.equal(deliveryFor(d,{type:'lead.connected',channel:'WHATSAPP',listId:'a'}),false);
 assert.equal(deliveryFor({events:['lead.connected'],listIds:['b']},{type:'lead.connected',channel:'WHATSAPP',listId:'a'}),false);
 assert.equal(deliveryFor({events:['lead.created'],listIds:['a']},{type:'lead.created',listId:'a'}),true);
});

test('07C.1b bearer parsing accepts only well-formed API keys; scopes are a closed list',async()=>{
 const {parseBearer,apiKeyInputSchema,apiScopes,tokenPrefix}=await import('../src/domain/api-credentials.ts');
 const token='pcak_'+'A'.repeat(43);
 assert.equal(parseBearer('Bearer '+token),token);assert.equal(parseBearer('bearer '+token),token);
 assert.equal(parseBearer(null),null);assert.equal(parseBearer('Basic abc'),null);assert.equal(parseBearer('Bearer pcak_short'),null);assert.equal(parseBearer('Bearer '+token+' extra'),null);
 assert.equal(tokenPrefix(token),'pcak_AAAAAAA');
 assert.deepEqual([...apiScopes],['leads:read','events:read']);
 assert.equal(apiKeyInputSchema.safeParse({name:'n8n',scopes:['leads:read']}).success,true);
 assert.equal(apiKeyInputSchema.safeParse({name:'n8n',scopes:['leads:write']}).success,false);
 assert.equal(apiKeyInputSchema.safeParse({name:'',scopes:['leads:read']}).success,false);
 assert.equal(apiKeyInputSchema.safeParse({name:'n8n',scopes:[]}).success,false);
});
