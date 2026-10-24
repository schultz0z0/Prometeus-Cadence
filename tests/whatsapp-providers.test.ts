import test from 'node:test';
import assert from 'node:assert/strict';
import {createMetaAdapter} from '../src/server/channels/providers/meta.ts';
import type {ProviderConfig} from '../src/server/channels/providers/contracts.ts';
import type {PreparedSend,TemplateView} from '../src/domain/whatsapp.ts';
const meta:ProviderConfig={provider:'meta',connectionId:'c',revision:1,identifiers:{appId:'111',wabaId:'222',phoneNumberId:'333'},credentials:{accessToken:'fixture-token',appSecret:'fixture-secret'},sender:{id:'s',connectionId:'c',provider:'meta',externalId:'333',address:'+5541999999999',identityScope:'meta:222',revision:1,ready:true,dailyLimit:10},templates:[]};
const send:PreparedSend={connectionId:'c',connectionRevision:1,senderId:'s',identity:{scope:'meta:222',externalId:'5541988888888',phone:'+5541988888888'},content:{kind:'text',text:'Olá'},purpose:'service'};
const json=(v:unknown,status=200,headers:HeadersInit={})=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json',...headers}});

test('Meta verifies token scopes app WABA and sender before any sending; builds JSON Cloud API request',async()=>{
 const calls:string[]=[];
 const adapter=createMetaAdapter(async(url,init)=>{
  const u=new URL(String(url));calls.push(u.pathname);assert.equal(init?.redirect,'error');
  if(u.pathname.endsWith('/debug_token'))return json({data:{is_valid:true,app_id:'111',scopes:['whatsapp_business_management','whatsapp_business_messaging'],expires_at:0}});
  if(u.pathname.endsWith('/phone_numbers'))return json({data:[{id:'333',display_phone_number:'+55 41 99999-9999',code_verification_status:'VERIFIED',status:'CONNECTED'}]});
  if(u.pathname.endsWith('/messages')){assert.equal(new Headers(init?.headers).get('authorization'),'Bearer fixture-token');assert.deepEqual(JSON.parse(String(init?.body)),{messaging_product:'whatsapp',to:'5541988888888',type:'text',text:{body:'Olá',preview_url:false}});return json({messaging_product:'whatsapp',messages:[{id:'wamid.fixture'}]});}
  return json({id:'222',name:'QA'});
 });
 assert.equal((await adapter.verifyAssets(meta)).externalAccountId,'222');
 assert.equal((await adapter.sendOnce(meta,send,'https://hooks.example/status')).kind,'accepted');
 assert.equal(calls.every(p=>p.startsWith('/v26.0/')),true);
 const denied=createMetaAdapter(async url=>String(url).includes('debug_token')?json({data:{is_valid:true,app_id:'other',scopes:[]}}):json({data:[]}));
 await assert.rejects(denied.verifyAssets(meta));
});
test('lost malformed oversized and server-error POST responses remain uncertain; proven auth failures never retry',async()=>{
 for(const response of [()=>{throw Error('lost')},()=>new Response('not-json'),()=>json({}),()=>json({error:{code:1}},500),()=>new Response('x'.repeat(2097153))]){
  const adapter=createMetaAdapter(async()=>response());assert.equal((await adapter.sendOnce(meta,send,'https://hooks.example/status')).kind,'uncertain');
 }
 const rejected=await createMetaAdapter(async()=>json({error:{code:190}},401)).sendOnce(meta,send,'https://hooks.example/status');
 assert.deepEqual(rejected,{kind:'not_accepted',code:'META_190',retryable:false,retryAfterMs:null});
 assert.equal(await createMetaAdapter().lookupMessage(meta,'wamid.known'),null);
});
test('template catalogs preserve approved schema and reject pagination to untrusted hosts',async()=>{
 const catalog=await createMetaAdapter(async()=>json({data:[{id:'444',name:'hello',language:'pt_BR',status:'APPROVED',components:[{type:'BODY',text:'Olá {{1}}'}]}]})).listTemplates(meta);
 assert.equal(catalog[0].status,'approved');assert.deepEqual(catalog[0].parameters,[{component:'body',key:'body.1',type:'text'}]);
 const unsafe=createMetaAdapter(async()=>json({data:[],paging:{next:'https://evil.example/path',cursors:{after:'x'}}}));
 await assert.rejects(unsafe.listTemplates(meta));
});
