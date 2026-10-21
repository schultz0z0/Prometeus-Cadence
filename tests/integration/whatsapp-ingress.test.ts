import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {getPools} from '../../src/server/db/pool.ts';
import {closeIngressPool} from '../../src/server/channels/ingress-db.ts';
import {webhookRequest} from '../../src/server/channels/webhooks.ts';
import {listConversations,readConversation} from '../../src/server/messaging/inbox.ts';
import {verifiedMetaFixture,whatsappUser,testAdmin} from './whatsapp-helpers.ts';
after(async()=>{await getPools().close();await closeIngressPool();});
test('authenticated duplicate inbound creates one message and response barrier; opaque contacts need no fake lead',async()=>{
 const f=await verifiedMetaFixture(),b=await whatsappUser(),message={messages:[{id:'wamid.'+randomUUID(),from:'BSUID-opaque-contact',timestamp:String(Math.floor(Date.now()/1000)),type:'image',image:{id:'attachment'}}]};
 const first=await webhookRequest(f.request(message),f.publicId,'meta');assert.equal(first.status,200);
 assert.equal((await webhookRequest(f.request(message),f.publicId,'meta')).status,200);
 const list=await listConversations(f.u.p,{});assert.equal(list.items.length,1);assert.equal(list.items[0].identity.phone,null);assert.equal(list.items[0].leadId,null);assert.equal(list.items[0].unread,1);
 const thread=await readConversation(f.u.p,list.items[0].id);assert.equal(thread.messages.length,1);assert.equal(thread.messages[0].mediaKind,'image');
 assert.equal((await listConversations(b.p,{})).items.length,0);await assert.rejects(readConversation(b.p,list.items[0].id),{status:404});
 const rows=await testAdmin(async c=>(await c.query('SELECT reply_epoch,last_inbound_at FROM app.channel_identity WHERE workspace_id=$1',[f.u.p.workspaceId])).rows);assert.equal(Number(rows[0].reply_epoch),1);assert.ok(rows[0].last_inbound_at);
 const invalid=f.request({messages:[{...message.messages[0],id:'invalid-new'}]});invalid.headers.set('x-hub-signature-256','sha256='+'0'.repeat(64));assert.equal((await webhookRequest(invalid,f.publicId,'meta')).status,403);assert.equal((await readConversation(f.u.p,list.items[0].id)).messages.length,1);
});
test('old duplicate and future inbound never extend the service window; opt-out is persisted before acknowledgement',async()=>{
 const f=await verifiedMetaFixture(),now=Math.floor(Date.now()/1000),from='5541988888888';
 const incoming=(id:string,timestamp:number,text:string)=>({messages:[{id,from,timestamp:String(timestamp),type:'text',text:{body:text}}]});
 const old=incoming('wamid.old.'+randomUUID(),now-90000,'Oi');assert.equal((await webhookRequest(f.request(old),f.publicId,'meta')).status,200);
 const lookup=()=>testAdmin(async c=>(await c.query('SELECT * FROM app.channel_identity WHERE workspace_id=$1',[f.u.p.workspaceId])).rows[0]);const before=await lookup();
 await webhookRequest(f.request(old),f.publicId,'meta');assert.equal((await lookup()).last_inbound_at.toISOString(),before.last_inbound_at.toISOString());
 await webhookRequest(f.request(incoming('wamid.future.'+randomUUID(),now+3600,'Oi')),f.publicId,'meta');assert.equal((await lookup()).last_inbound_at.toISOString(),before.last_inbound_at.toISOString());
 assert.equal((await webhookRequest(f.request(incoming('wamid.stop.'+randomUUID(),now,'Parar')),f.publicId,'meta')).status,200);
 const count=await testAdmin(async c=>(await c.query('SELECT count(*) FROM app.contact_suppression WHERE workspace_id=$1',[f.u.p.workspaceId])).rows[0].count);assert.equal(Number(count),1);
});
test('status evidence is idempotent and never regresses delivered/read on late sent or failure',async()=>{
 const f=await verifiedMetaFixture();await webhookRequest(f.request({messages:[{id:'wamid.in.'+randomUUID(),from:'5541988888888',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Olá'}}]}),f.publicId,'meta');
 const conversation=(await listConversations(f.u.p,{})).items[0],id=randomUUID(),remote='wamid.out.'+randomUUID();
 await testAdmin(c=>c.query("INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,text,state,remote_id) SELECT workspace_id,$2,connection_id,sender_id,identity_id,id,'outbound','Oi','accepted',$3 FROM app.channel_conversation WHERE workspace_id=$1 AND id=$4",[f.u.p.workspaceId,id,remote,conversation.id]));
 for(const status of ['delivered','read','sent','failed','read'])assert.equal((await webhookRequest(f.request({statuses:[{id:remote,status,timestamp:String(Math.floor(Date.now()/1000))}]}),f.publicId,'meta')).status,200);
 const result=await testAdmin(async c=>(await c.query('SELECT state,delivered_at,read_at FROM app.channel_message WHERE workspace_id=$1 AND id=$2',[f.u.p.workspaceId,id])).rows[0]);assert.equal(result.state,'read');assert.ok(result.delivered_at);assert.ok(result.read_at);
 const evidence=await testAdmin(async c=>(await c.query('SELECT count(*) FROM app.channel_status_evidence WHERE workspace_id=$1 AND remote_id=$2',[f.u.p.workspaceId,remote])).rows[0].count);assert.equal(Number(evidence),4);
});
