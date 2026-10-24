import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {getPools} from '../../src/server/db/pool.ts';
import {saveConnection,readConnections} from '../../src/server/channels/repository.ts';
import {verifyConnection,disconnectConnection} from '../../src/server/channels/connections.ts';
import {syncTemplates} from '../../src/server/channels/templates.ts';
import {createMetaAdapter} from '../../src/server/channels/providers/meta.ts';
import {verifyMetaChallenge} from '../../src/server/channels/webhook-auth.ts';
import {closeIngressPool} from '../../src/server/channels/ingress-db.ts';
import {whatsappUser,metaConnectionInput,testAdmin} from './whatsapp-helpers.ts';
const fixtureAdapter=(phone:string='333333',waba:string='222222',appId:string='123456')=>createMetaAdapter(async url=>{
 const path=new URL(String(url)).pathname;const data=path.endsWith('debug_token')?{data:{is_valid:true,app_id:appId,scopes:['whatsapp_business_management','whatsapp_business_messaging']}}:path.endsWith('phone_numbers')?{data:[{id:phone,display_phone_number:'+5541999999999',code_verification_status:'VERIFIED',status:'CONNECTED'}]}:path.endsWith('message_templates')?{data:[{id:'444444',name:'hello',language:'pt_BR',status:'APPROVED',components:[{type:'BODY',text:'Olá {{1}}'}]}]}:{id:waba};return Response.json(data);
});
after(async()=>{await getPools().close();await closeIngressPool();});
test('verified assets become pending webhook; challenge is separate from actual inbound and sync is versioned',async()=>{
 const u=await whatsappUser(),input=metaConnectionInput();input.identifiers.wabaId=String(Date.now());
 const saved=await saveConnection(u.p,input),adapter=fixtureAdapter(input.identifiers.phoneNumberId,input.identifiers.wabaId);
 const verified=await verifyConnection(u.p,saved.id,1,{adapter});assert.equal(verified.state,'awaiting_webhook');assert.equal(verified.senders.length,1);
 const row=await testAdmin(async c=>(await c.query('SELECT public_id FROM app.channel_connection WHERE id=$1',[saved.id])).rows[0]);
 const secret=await testAdmin(async c=>(await c.query('SELECT envelope FROM app.channel_credential WHERE connection_id=$1',[saved.id])).rows[0]);assert.equal(JSON.stringify(secret).includes('fixture-verify'),false);
 const {readVerifyToken}=await import('../../src/server/channels/connections.ts');const {verifyToken}=await readVerifyToken(u.p,saved.id);
 await verifyMetaChallenge(new Request('https://hooks.example/path?hub.mode=subscribe&hub.verify_token='+verifyToken+'&hub.challenge=ok'),row.public_id);
 const current=(await readConnections(u.p))[0];assert.equal(current.verification.challenge,true);assert.equal(current.verification.inbound,false);assert.equal(current.state,'awaiting_webhook');
 const first=await syncTemplates(u.p,saved.id,1,{adapter}),second=await syncTemplates(u.p,saved.id,1,{adapter});assert.equal(first[0].id,second[0].id);assert.equal(first[0].revision,second[0].revision);
 await disconnectConnection(u.p,{id:saved.id,requestId:randomUUID(),expectedRevision:1});assert.equal((await readConnections(u.p))[0].state,'disconnected');
});
test('one remote account cannot be claimed across workspaces and rotation defeats in-flight verification',async()=>{
 const a=await whatsappUser(),b=await whatsappUser(),input=metaConnectionInput();input.identifiers.wabaId=String(Date.now()+1);
 const one=await saveConnection(a.p,input),two=await saveConnection(b.p,{...input,requestId:randomUUID()});
 const results=await Promise.allSettled([verifyConnection(a.p,one.id,1,{adapter:fixtureAdapter(input.identifiers.phoneNumberId,input.identifiers.wabaId)}),verifyConnection(b.p,two.id,1,{adapter:fixtureAdapter(input.identifiers.phoneNumberId,input.identifiers.wabaId)})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const c=await whatsappUser(),fresh={...metaConnectionInput(),identifiers:{...input.identifiers,wabaId:String(Date.now()+2)}},saved=await saveConnection(c.p,fresh);
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),adapter=fixtureAdapter(fresh.identifiers.phoneNumberId,fresh.identifiers.wabaId);
 let started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);
 const pending=verifyConnection(c.p,saved.id,1,{adapter:{...adapter,verifyAssets:async config=>{started();await gate;return adapter.verifyAssets(config);}}});await ready;
 await saveConnection(c.p,{...fresh,id:saved.id,expectedRevision:1,requestId:randomUUID()});release();await assert.rejects(pending,{status:409});
});
