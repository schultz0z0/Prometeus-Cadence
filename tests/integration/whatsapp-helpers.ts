import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import {prospectingUser,testAdmin} from './prospecting-helpers.ts';
import {resetRateLimits} from './helpers.ts';
export {testAdmin};
export async function whatsappUser(){
 await resetRateLimits();
 process.env.CHANNEL_KEYRING_JSON=JSON.stringify({fixture:Buffer.alloc(32,12).toString('base64')});process.env.CHANNEL_ACTIVE_KEY_ID='fixture';
 process.env.CHANNEL_PUBLIC_BASE_URL='https://hooks.example';
 return prospectingUser();
}
export function metaConnectionInput(){return {requestId:randomUUID(),expectedRevision:0,provider:'meta' as const,name:'QA Meta',identifiers:{appId:'123456',wabaId:'222222',phoneNumberId:'333333'},credentials:{accessToken:'fixture-access-token',appSecret:'fixture-app-secret'}};}
export async function verifiedMetaFixture(){
 const u=await whatsappUser(),input=metaConnectionInput();input.identifiers.wabaId=BigInt('0x'+randomBytes(6).toString('hex')).toString();input.identifiers.phoneNumberId=BigInt('0x'+randomBytes(6).toString('hex')).toString();
 const {saveConnection}=await import('../../src/server/channels/repository.ts'),{verifyConnection}=await import('../../src/server/channels/connections.ts'),{createMetaAdapter}=await import('../../src/server/channels/providers/meta.ts');
 const connection=await saveConnection(u.p,input),adapter=createMetaAdapter(async url=>{
  const path=new URL(String(url)).pathname;
  return Response.json(path.endsWith('debug_token')?{data:{is_valid:true,app_id:input.identifiers.appId,scopes:['whatsapp_business_management','whatsapp_business_messaging']}}:path.endsWith('phone_numbers')?{data:[{id:input.identifiers.phoneNumberId,display_phone_number:'+5541999999999',code_verification_status:'VERIFIED',status:'CONNECTED'}]}:path.endsWith('message_templates')?{data:[{id:'444444',name:'hello',language:'pt_BR',status:'APPROVED',components:[{type:'BODY',text:'Olá {{1}}, podemos conversar?'}]}]}:{id:input.identifiers.wabaId});
 });
 const verified=await verifyConnection(u.p,connection.id,1,{adapter});
 const publicId=await testAdmin(async c=>(await c.query('SELECT public_id FROM app.channel_connection WHERE id=$1',[connection.id])).rows[0].public_id as string);
 const request=(message:Record<string,unknown>,field='messages')=>{
  const body=JSON.stringify({object:'whatsapp_business_account',entry:[{id:input.identifiers.wabaId,changes:[{field,value:field==='messages'?{metadata:{phone_number_id:input.identifiers.phoneNumberId},...message}:message}]}]});
  return new Request('https://hooks.example/api/channel-webhooks/meta/'+publicId,{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+createHmac('sha256',input.credentials.appSecret).update(body).digest('hex')},body});
 };
 return {u,input,connection:verified,sender:verified.senders[0],publicId,request,adapter};
}
