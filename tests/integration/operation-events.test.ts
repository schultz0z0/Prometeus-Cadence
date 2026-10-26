import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {whatsappUser,metaConnectionInput,testAdmin} from './whatsapp-helpers.ts';
import {saveConnection} from '../../src/server/channels/repository.ts';
import {getPools} from '../../src/server/db/pool.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {readOperationEvents} from '../../src/server/operations/repository.ts';
import {operationEventsRequest} from '../../src/server/operations/http.ts';
import {base} from './helpers.ts';
import {setTimeout as pause} from 'node:timers/promises';
after(async()=>getPools().close());
test('operational transitions are transactional, no-op safe, private and tenant scoped',async()=>{
 const u=await whatsappUser(),other=await whatsappUser();
 const saved=await saveConnection(u.p,metaConnectionInput());
 const before=await readOperationEvents(u.p,{}),row=before.items.find(e=>e.entityId===saved.id);
 assert.equal(row?.kind,'channel');assert.equal(row?.state,'pending');
 assert.doesNotMatch(JSON.stringify(before),/fixture-access-token|fixture-app-secret|ciphertext|appSecret|accessToken|identifiers/);
 const cursor=before.nextCursor;
 await testAdmin(c=>c.query('UPDATE app.channel_connection SET updated_at=clock_timestamp() WHERE id=$1',[saved.id]));
 assert.equal((await readOperationEvents(u.p,{cursor})).items.length,0);
 await assert.rejects(testAdmin(async c=>{await c.query('BEGIN');try{await c.query("UPDATE app.channel_connection SET state='attention' WHERE id=$1",[saved.id]);throw Error('rollback fixture');}finally{await c.query('ROLLBACK');}}));
 assert.equal((await readOperationEvents(u.p,{cursor})).items.length,0);
 await testAdmin(c=>c.query("UPDATE app.channel_connection SET state='attention' WHERE id=$1",[saved.id]));
 const change=await readOperationEvents(u.p,{cursor});assert.equal(change.items.length,1);assert.equal(change.items[0].state,'attention');
 assert(!(await readOperationEvents(other.p,{})).items.some(e=>e.entityId===saved.id));
 await assert.rejects(readOperationEvents(other.p,{cursor}),{status:422});
 await assert.rejects(withWorkspaceTransaction(u.p,c=>c.query("INSERT INTO app.operation_event(workspace_id,sequence,kind,entity_id,state,revision) VALUES($1,999,'channel','forged','ready',0)",[u.p.workspaceId])),/permission denied/);
});
test('feed pages are bounded and resume without skipping equal timestamps or later commits',async()=>{
 const u=await whatsappUser(),saved=await saveConnection(u.p,metaConnectionInput()),start=await readOperationEvents(u.p,{});
 await testAdmin(async c=>{for(let i=0;i<105;i++)await c.query('UPDATE app.channel_connection SET revision=revision+1 WHERE id=$1',[saved.id]);});
 const first=await readOperationEvents(u.p,{cursor:start.nextCursor,limit:100});assert.equal(first.items.length,100);assert.equal(first.hasMore,true);
 const second=await readOperationEvents(u.p,{cursor:first.nextCursor,limit:100});assert.equal(second.items.length,5);assert.equal(second.hasMore,false);
 assert.equal(new Set([...first.items,...second.items].map(e=>e.sequence)).size,105);
 await Promise.all(Array.from({length:5},()=>testAdmin(c=>c.query('UPDATE app.channel_connection SET revision=revision+1 WHERE id=$1',[saved.id]))));
 assert.equal((await readOperationEvents(u.p,{cursor:second.nextCursor})).items.length,5);
 for(const options of [{limit:101},{limit:0},{cursor:'not-a-cursor'}])await assert.rejects(readOperationEvents(u.p,options),{status:422});
});
test('HTTP feed checks session/workspace, read-only method and fresh membership',async()=>{
 const u=await whatsappUser(),url=base+'/api/operations/events';
 assert.equal((await operationEventsRequest(new Request(url))).status,401);
 const headers=new Headers(u.headers);
 const response=await operationEventsRequest(new Request(url,{headers}));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal((await operationEventsRequest(new Request(url+'?limit=101',{headers}))).status,422);
 assert.equal((await operationEventsRequest(new Request(url,{method:'POST',headers}))).status,405);
 headers.set('x-cadence-workspace',randomUUID());assert.equal((await operationEventsRequest(new Request(url,{headers}))).status,409);
 await testAdmin(c=>c.query('DELETE FROM auth.member WHERE "userId"=$1 AND "organizationId"=$2',[u.p.userId,u.p.workspaceId]));
 assert.equal((await operationEventsRequest(new Request(url,{headers:u.headers}))).status,403);
});
test('cursor follows commit order without blocking independent business rows before commit',async()=>{
 const u=await whatsappUser(),a=await saveConnection(u.p,metaConnectionInput()),b=await saveConnection(u.p,metaConnectionInput()),start=await readOperationEvents(u.p,{});
 await testAdmin(async c=>{
  await c.query('BEGIN');let second:Promise<unknown>|undefined;
  try{
   await c.query('UPDATE app.channel_connection SET revision=revision+1 WHERE id=$1',[a.id]);
   second=testAdmin(other=>other.query('UPDATE app.channel_connection SET revision=revision+1 WHERE id=$1',[b.id]));
   const completed=await Promise.race([second.then(()=>true),pause(1000).then(()=>false)]);
   assert.equal(completed,true,'A transaction must not hold the cursor lock throughout its business work');
   const visible=await readOperationEvents(u.p,{cursor:start.nextCursor});assert.deepEqual(visible.items.map(e=>e.entityId),[b.id]);
   await c.query('COMMIT');await second;
  }finally{await c.query('ROLLBACK');await second;}
 });
 const page=await readOperationEvents(u.p,{cursor:start.nextCursor});assert.deepEqual(page.items.map(e=>e.entityId),[b.id,a.id]);
});
test('large histories use cursor index and limit payload without downloading the journal',async()=>{
 const u=await whatsappUser(),connection=await saveConnection(u.p,metaConnectionInput());
 const started=performance.now();
 await testAdmin(c=>c.query(`INSERT INTO app.channel_connection(workspace_id,id,provider,name,public_id,identifiers,created_by)
  SELECT $1,gen_random_uuid()::text,'meta','Volume fixture',gen_random_uuid()::text,'{}',$2 FROM generate_series(1,10000)`,[u.p.workspaceId,u.p.userId]));
 const t=performance.now(),page=await readOperationEvents(u.p,{limit:100});assert.equal(page.items.length,100);assert.equal(page.hasMore,true);assert(Buffer.byteLength(JSON.stringify(page))<100000);
 const plan=await withWorkspaceTransaction(u.p,async c=>{await c.query('ANALYZE app.operation_event');return (await c.query('EXPLAIN (FORMAT JSON) SELECT * FROM app.operation_event WHERE workspace_id=$1 AND sequence>1 ORDER BY sequence LIMIT 100',[u.p.workspaceId])).rows;});
 assert.match(JSON.stringify(plan),/Index (Only )?Scan/);
 console.log(JSON.stringify({fixture:'10000 operational rows, isolated test database',seedMs:Math.round(t-started),pageMs:Math.round(performance.now()-t),bytes:Buffer.byteLength(JSON.stringify(page)),entity:!!connection.id}));
});
test('same-plan active renewals record changed periods even without a revision bump',async()=>{
 const u=await whatsappUser();
 await testAdmin(c=>c.query("UPDATE app.billing_account SET state='active',subscription_id='sub_fixture_renewal' WHERE workspace_id=$1",[u.p.workspaceId]));
 const initial=await readOperationEvents(u.p,{});
 await testAdmin(c=>c.query("UPDATE app.billing_account SET period_start=period_start+interval '1 month',period_end=period_end+interval '1 month' WHERE workspace_id=$1",[u.p.workspaceId]));
 const renewed=await readOperationEvents(u.p,{cursor:initial.nextCursor});assert.equal(renewed.items.length,1);assert.equal(renewed.items[0].kind,'billing');assert.equal(renewed.items[0].state,'active');
 await testAdmin(c=>c.query('UPDATE app.billing_account SET period_start=period_start,period_end=period_end,last_synced_at=clock_timestamp() WHERE workspace_id=$1',[u.p.workspaceId]));
 assert.equal((await readOperationEvents(u.p,{cursor:renewed.nextCursor})).items.length,0);
});
