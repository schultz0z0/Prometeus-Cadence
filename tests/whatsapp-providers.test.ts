import test from 'node:test';
import assert from 'node:assert/strict';
import {createMetaAdapter} from '../src/server/channels/providers/meta.ts';
import {createTwilioAdapter} from '../src/server/channels/providers/twilio.ts';
import type {ProviderConfig} from '../src/server/channels/providers/contracts.ts';
import type {PreparedSend,TemplateView} from '../src/domain/whatsapp.ts';
const account='AC'+'a'.repeat(32),key='SK'+'b'.repeat(32),contentSid='HX'+'c'.repeat(32);
const meta:ProviderConfig={provider:'meta',connectionId:'c',revision:1,identifiers:{appId:'111',wabaId:'222',phoneNumberId:'333'},credentials:{accessToken:'fixture-token',appSecret:'fixture-secret'},sender:{id:'s',connectionId:'c',provider:'meta',externalId:'333',address:'+5541999999999',identityScope:'meta:222',revision:1,ready:true,dailyLimit:10},templates:[]};
const twilio:ProviderConfig={provider:'twilio',connectionId:'c',revision:1,identifiers:{accountSid:account,sender:'+5541999999999',authMode:'api-key'},credentials:{apiKeySid:key,apiKeySecret:'api-secret',authToken:'callback-token'},sender:{...meta.sender!,provider:'twilio',externalId:'XE'+'d'.repeat(32),identityScope:'twilio:'+account},templates:[]};
const send:PreparedSend={connectionId:'c',connectionRevision:1,senderId:'s',identity:{scope:'meta:222',externalId:'5541988888888',phone:'+5541988888888'},content:{kind:'text',text:'Olá'},purpose:'service'};
const json=(v:unknown,status=200,headers:HeadersInit={})=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json',...headers}});

test('Twilio repeated placeholders bind one value per named parameter',async()=>{
 const adapter=createTwilioAdapter(async(url)=>String(url).includes('ApprovalRequests')?json({account_sid:account,whatsapp:{status:'approved'}}):json({contents:[{account_sid:account,sid:contentSid,friendly_name:'Repeat',language:'pt_BR',types:{'twilio/text':{body:'Olá {{1}}, confirme {{1}}'}}}],meta:{next_page_url:null}}));
 const templates=await adapter.listTemplates(twilio);assert.equal(templates[0].parameters.length,1);assert.equal(templates[0].parameters[0].key,'body.1');
});
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
test('Twilio uses API key basic auth explicit From and ContentSid without Body; validates enabled sender and pool',async()=>{
 const template:TemplateView={id:'local',connectionId:'c',provider:'twilio',remoteId:contentSid,name:'hello',language:'pt_BR',revision:1,hash:'h',status:'approved',parameters:[{component:'body',key:'body.1',type:'text'}],components:[{type:'body',text:'Olá {{1}}'}]};
 const adapter=createTwilioAdapter(async(url,init)=>{
  const u=new URL(String(url));assert.equal(new Headers(init?.headers).get('authorization'),'Basic '+Buffer.from(key+':api-secret').toString('base64'));
  if(u.pathname.endsWith('/Channels/Senders'))return json({senders:[{sid:'XE'+'d'.repeat(32),account_sid:account,sender_id:'whatsapp:+5541999999999',status:'ONLINE'}],meta:{next_page_url:null}});
  if(u.pathname.endsWith('/Messages.json')){
   const form=new URLSearchParams(String(init?.body));assert.equal(form.get('From'),'whatsapp:+5541999999999');assert.equal(form.get('To'),'whatsapp:+5541988888888');assert.equal(form.get('ContentSid'),contentSid);assert.equal(form.has('Body'),false);assert.equal(form.get('ContentVariables'),'{"1":"Maria"}');assert.equal(form.get('StatusCallback'),'https://hooks.example/status');
   return json({sid:'SM'+'e'.repeat(32),account_sid:account,status:'queued'},201);
  }
  return json({sid:account,status:'active'});
 });
 assert.equal((await adapter.verifyAssets(twilio)).senders.length,1);
 assert.equal((await adapter.sendOnce({...twilio,templates:[template]},{...send,identity:{...send.identity,scope:'twilio:'+account},content:{kind:'template',templateId:'local',templateRevision:1,variables:{'body.1':'Maria'}}},'https://hooks.example/status')).kind,'accepted');
 const offline=createTwilioAdapter(async url=>String(url).includes('Channels/Senders')?json({senders:[{sid:'XE'+'d'.repeat(32),sender_id:'whatsapp:+5541999999999',status:'OFFLINE'}],meta:{next_page_url:null}}):json({sid:account,status:'active'}));
 await assert.rejects(offline.verifyAssets(twilio));
 const wrongPool=createTwilioAdapter(async url=>String(url).includes('Channels/Senders')?json({senders:[{sid:'XE'+'d'.repeat(32),sender_id:'whatsapp:+5541999999999',status:'ONLINE'}],meta:{next_page_url:null}}):String(url).includes('Services')?json({sid:'MG'+'f'.repeat(32),account_sid:'other'}):json({sid:account,status:'active'}));
 await assert.rejects(wrongPool.verifyAssets({...twilio,identifiers:{...twilio.identifiers,messagingServiceSid:'MG'+'f'.repeat(32)}}));
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
