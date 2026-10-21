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
import {publicationFixture} from './messaging-helpers.ts';

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
