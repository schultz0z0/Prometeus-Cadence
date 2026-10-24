import test from 'node:test';
import assert from 'node:assert/strict';
import {createMetaAdapter} from '../src/server/channels/providers/meta.ts';
import type {ProviderConfig} from '../src/server/channels/providers/contracts.ts';
const config:ProviderConfig={provider:'meta',connectionId:'qa',revision:1,identifiers:{appId:'111',wabaId:'222',phoneNumberId:'333'},credentials:{accessToken:'qa-token',appSecret:'qa-secret'},sender:null,templates:[]};
function adapter(status:unknown,code='NOT_VERIFIED',phoneId='333'){
 const paths:string[]=[];
 return {paths,provider:createMetaAdapter(async(url,init)=>{
  assert.equal(init?.method??'GET','GET');const u=new URL(String(url));paths.push(u.pathname);
  if(u.pathname.endsWith('debug_token'))return Response.json({data:{is_valid:true,app_id:'111',scopes:['whatsapp_business_management','whatsapp_business_messaging']}});
  if(u.pathname.endsWith('phone_numbers')){
   assert.ok(u.searchParams.get('fields')?.split(',').includes('status'));
   return Response.json({data:[{id:phoneId,display_phone_number:'+1 555 669 0596',account_mode:'LIVE',status,code_verification_status:code}]});
  }return Response.json({id:'222'});
 })};
}
test('Meta CONNECTED sender is eligible even when test number OTP status is NOT_VERIFIED',async()=>{
 const {provider,paths}=adapter('CONNECTED');const result=await provider.verifyAssets(config);assert.equal(result.senders[0].externalId,'333');assert.equal(result.senders[0].address,'+15556690596');assert.equal(paths.length,3);assert.equal(paths.some(p=>p.endsWith('/messages')),false);
});
test('OTP VERIFIED cannot authorize a disconnected, restricted or missing sender status',async()=>{
 for(const status of ['DISCONNECTED','PENDING','BANNED','RESTRICTED','FLAGGED','UNVERIFIED',undefined])await assert.rejects(()=>adapter(status,'VERIFIED').provider.verifyAssets(config),{code:'META_SENDER_UNAVAILABLE'});
 await assert.rejects(()=>adapter('CONNECTED','VERIFIED','999').provider.verifyAssets(config),{code:'META_SENDER_UNAVAILABLE'});
});
