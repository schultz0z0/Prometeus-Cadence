import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {getPools} from '../../src/server/db/pool.ts';
import {closeIngressPool} from '../../src/server/channels/ingress-db.ts';
import {closeDispatchPool} from '../../src/server/messaging/worker-db.ts';
import {webhookRequest} from '../../src/server/channels/webhooks.ts';
import {syncTemplates} from '../../src/server/channels/templates.ts';
import {recordConsent} from '../../src/server/messaging/consent.ts';
import {preparePublication,confirmPublication} from '../../src/server/messaging/publication.ts';
import {materializeDueMessages} from '../../src/server/messaging/outbox.ts';
import {defaultCadenceSettings} from '../../src/demo/seed.ts';
import {verifiedMetaFixture,testAdmin} from './whatsapp-helpers.ts';
import type {Cadence,Lead} from '../../src/domain/model.ts';
export async function publicationFixture(){
 const f=await verifiedMetaFixture(),now=new Date(),date=now.toISOString(),time=new Date(now.getTime()+60000).toISOString().slice(11,16);
 await webhookRequest(f.request({messages:[{id:'wamid.'+randomUUID(),from:'5541988888888',timestamp:String(Math.floor(now.getTime()/1000)),type:'text',text:{body:'Oi'}}]}),f.publicId,'meta');
 const templates=await syncTemplates(f.u.p,f.connection.id,1,{adapter:f.adapter});
 const listId=randomUUID(),lead:Lead={id:randomUUID(),listId,name:'Clínica QA',phone:'+5541988888888',qualification:'qualified',source:'MANUAL',createdAt:date};
 const cadence:Cadence={id:randomUUID(),listId,name:'Cadência QA',status:'draft',createdAt:date,steps:[{id:'first',channel:'WHATSAPP',delayDays:0,body:'Olá {{nome}}',stopOnReply:true},{id:'second',channel:'WHATSAPP',delayDays:2,body:'Podemos conversar?',stopOnReply:true}],settings:{...defaultCadenceSettings(),timezone:'UTC',weekdays:[0,1,2,3,4,5,6],sendTime:time,skipHolidays:false,excludeReplied:false}};
 const identity=await testAdmin(async c=>{
  await c.query('INSERT INTO app.list(workspace_id,id,name) VALUES($1,$2,$3)',[f.u.p.workspaceId,listId,'QA']);
  await c.query('INSERT INTO app.lead(workspace_id,id,list_id,payload) VALUES($1,$2,$3,$4)',[f.u.p.workspaceId,lead.id,listId,lead]);
  await c.query('INSERT INTO app.cadence(workspace_id,id,list_id,payload) VALUES($1,$2,$3,$4)',[f.u.p.workspaceId,cadence.id,listId,cadence]);
  await c.query('INSERT INTO app.messaging_limits(workspace_id,workspace_daily_limit,timezone) VALUES($1,10,\'UTC\')',[f.u.p.workspaceId]);
  await c.query('UPDATE app.channel_sender SET daily_limit=10 WHERE workspace_id=$1',[f.u.p.workspaceId]);
  return (await c.query('SELECT id FROM app.channel_identity WHERE workspace_id=$1',[f.u.p.workspaceId])).rows[0].id as string;
 });
 await recordConsent(f.u.p,{requestId:randomUUID(),identityId:identity,purpose:'campaign',source:'manual QA',occurredAt:date,evidence:'Contato fictício autorizado no ambiente de testes.'});
 const input={cadenceId:cadence.id,expectedRevision:0,senderId:f.sender.id,leadIds:[lead.id],bindings:{first:{kind:'text' as const,text:'Olá {{nome}}'},second:{kind:'template' as const,templateId:templates[0].id,templateRevision:templates[0].revision,variables:{'body.1':'{{nome}}'}}}};
 return {...f,lead,cadence,identity,input,now};
}
after(async()=>{await getPools().close();await closeIngressPool();await closeDispatchPool();});
test('publication is read-only until confirmed, idempotent, immutable and materializes one predecessor only',async()=>{
 const f=await publicationFixture(),review=await preparePublication(f.u.p,f.input);assert.deepEqual(review.blockers,[]);
 const count=()=>testAdmin(async c=>Number((await c.query('SELECT count(*) FROM app.message_outbox WHERE workspace_id=$1',[f.u.p.workspaceId])).rows[0].count));assert.equal(await count(),0);
 const command={...f.input,requestId:randomUUID(),reviewToken:review.token},first=await confirmPublication(f.u.p,command);assert.equal((await confirmPublication(f.u.p,command)).id,first.id);
 assert.ok((await preparePublication(f.u.p,f.input)).blockers.includes('CADENCE_ALREADY_ACTIVE'));
 await testAdmin(c=>c.query("UPDATE app.cadence SET payload=jsonb_set(payload,'{name}','\"Edited draft\"') WHERE workspace_id=$1 AND id=$2",[f.u.p.workspaceId,f.cadence.id]));
 const published=await testAdmin(async c=>(await c.query('SELECT snapshot FROM app.cadence_publication WHERE workspace_id=$1 AND id=$2',[f.u.p.workspaceId,first.id])).rows[0].snapshot);assert.equal(published.cadence.name,'Cadência QA');
 await materializeDueMessages(new Date(f.now.getTime()+120000).toISOString(),100);assert.equal(await count(),1);
 await materializeDueMessages(new Date(f.now.getTime()+864000000).toISOString(),100);assert.equal(await count(),1);
});
test('foreign role channel and preview mutations cannot authorize publication',async()=>{
 const f=await publicationFixture(),review=await preparePublication(f.u.p,f.input);
 await assert.rejects(confirmPublication(f.u.p,{...f.input,requestId:randomUUID(),reviewToken:review.token,bindings:{...f.input.bindings,first:{kind:'text',text:'Unreviewed'}}}),{status:409});
 await testAdmin(c=>c.query("UPDATE app.lead SET payload=jsonb_set(payload,'{phone}','\"+5511999999999\"') WHERE workspace_id=$1 AND id=$2",[f.u.p.workspaceId,f.lead.id]));
 await assert.rejects(confirmPublication(f.u.p,{...f.input,requestId:randomUUID(),reviewToken:review.token}),{status:409});
 await testAdmin(c=>c.query("UPDATE app.cadence SET payload=jsonb_set(payload,'{steps,1,channel}','\"EMAIL\"') WHERE workspace_id=$1 AND id=$2",[f.u.p.workspaceId,f.cadence.id]));
 assert.ok((await preparePublication(f.u.p,f.input)).blockers.some(b=>b.includes('CHANNEL_UNAVAILABLE')));
 await testAdmin(c=>c.query('UPDATE auth.member SET role=$3 WHERE "organizationId"=$1 AND "userId"=$2',[f.u.p.workspaceId,f.u.p.userId,'operator']));
 await assert.rejects(preparePublication(f.u.p,f.input),{status:403});
});
test('authenticated reply cancels all remaining enrollment messages even before dispatch materializes again',async()=>{
 const f=await publicationFixture(),review=await preparePublication(f.u.p,f.input);await confirmPublication(f.u.p,{...f.input,requestId:randomUUID(),reviewToken:review.token});
 await materializeDueMessages(new Date(f.now.getTime()+120000).toISOString(),100);
 await webhookRequest(f.request({messages:[{id:'wamid.reply.'+randomUUID(),from:'5541988888888',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Sim'}}]}),f.publicId,'meta');
 const state=await testAdmin(async c=>({enrollment:(await c.query('SELECT state FROM app.cadence_enrollment WHERE workspace_id=$1',[f.u.p.workspaceId])).rows[0].state,outbox:(await c.query('SELECT state FROM app.message_outbox WHERE workspace_id=$1',[f.u.p.workspaceId])).rows[0].state}));assert.equal(state.enrollment,'stopped');assert.equal(state.outbox,'cancelled');
});
