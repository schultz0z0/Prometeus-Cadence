import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {verifiedMetaFixture,testAdmin} from './whatsapp-helpers.ts';
import {getPools} from '../../src/server/db/pool.ts';
import {readMessageMetrics} from '../../src/server/messaging/metrics.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
after(async()=>getPools().close());
test('metric period is explicit, timezone bounded and excludes historical/future messages',async()=>{
 const f=await verifiedMetaFixture(),ws=f.u.p.workspaceId,identity=randomUUID(),conversation=randomUUID();
 await testAdmin(async c=>{
  await c.query("INSERT INTO app.workspace_preferences VALUES($1,'{\"timezone\":\"Asia/Tokyo\"}') ON CONFLICT(workspace_id) DO UPDATE SET payload=EXCLUDED.payload",[ws]);
  await c.query("INSERT INTO app.channel_identity(workspace_id,id,scope,external_id) VALUES($1,$2,'fixture',$2)",[ws,identity]);
  await c.query('INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id) VALUES($1,$2,$3,$4,$5)',[ws,conversation,f.connection.id,f.sender.id,identity]);
  await c.query(`INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,state,occurred_at)
   SELECT $1,gen_random_uuid()::text,$2,$3,$4,$5,'inbound','received',(((clock_timestamp() AT TIME ZONE 'Asia/Tokyo')::date)::timestamp AT TIME ZONE 'Asia/Tokyo')+delta
   FROM unnest(ARRAY[interval '-1 millisecond',interval '1 millisecond',interval '2 hours',interval '24 hours']) AS delta`,[ws,f.connection.id,f.sender.id,identity,conversation]);
 });
 const result=await readMessageMetrics(f.u.p,{days:1});assert.equal(result.replies,2);assert.equal(result.today.replies,2);assert.equal(result.sent,0);assert.equal(result.tracking.opens,null);
 assert.equal(result.period.timezone,'Asia/Tokyo');assert.equal(+new Date(result.period.to)-+new Date(result.period.from),86400000);
 const other=await verifiedMetaFixture();assert.equal((await readMessageMetrics(other.u.p,{days:1})).replies,0);
 await testAdmin(c=>c.query("UPDATE app.workspace_preferences SET payload='{\"timezone\":\"invalid/zone\"}' WHERE workspace_id=$1",[ws]));
 await assert.rejects(readMessageMetrics(f.u.p,{days:1}),{status:422});
});
test('valid persisted fixed-offset and GMT timezones keep correct local midnight',async()=>{
 const f=await verifiedMetaFixture();
 for(const timezone of ['Etc/GMT+3','Etc/GMT-2','GMT','+05:30']){
  await testAdmin(c=>c.query('INSERT INTO app.workspace_preferences VALUES($1,$2) ON CONFLICT(workspace_id) DO UPDATE SET payload=EXCLUDED.payload',[f.u.p.workspaceId,{timezone}]));
  const result=await readMessageMetrics(f.u.p,{days:1});
  assert.equal(result.period.timezone,timezone);
  assert.equal(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(result.period.from)),'00:00',timezone);
 }
});
test('metric window uses a timestamp index instead of loading a large historical message body',async()=>{
 const f=await verifiedMetaFixture(),ws=f.u.p.workspaceId,identity=randomUUID(),conversation=randomUUID();
 await testAdmin(async c=>{
  await c.query("INSERT INTO app.channel_identity(workspace_id,id,scope,external_id) VALUES($1,$2,'fixture',$2)",[ws,identity]);
  await c.query('INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id) VALUES($1,$2,$3,$4,$5)',[ws,conversation,f.connection.id,f.sender.id,identity]);
  await c.query(`INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,state,occurred_at)
   SELECT $1,gen_random_uuid()::text,$2,$3,$4,$5,'inbound','received',clock_timestamp()-interval '2 years' FROM generate_series(1,10000)`,[ws,f.connection.id,f.sender.id,identity,conversation]);
  await c.query(`INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,state,occurred_at)
   VALUES($1,gen_random_uuid()::text,$2,$3,$4,$5,'outbound','failed',clock_timestamp())`,[ws,f.connection.id,f.sender.id,identity,conversation]);
  await c.query('ANALYZE app.channel_message');
 });
 const start=performance.now(),result=await readMessageMetrics(f.u.p,{days:1});assert.equal(result.failed,1);assert.equal(result.replies,0);
 const plan=await withWorkspaceTransaction(f.u.p,async c=>(await c.query('EXPLAIN (FORMAT JSON) SELECT id FROM app.channel_message WHERE workspace_id=$1 AND metric_at>=$2 AND metric_at<$3',[ws,result.period.from,result.period.to])).rows);
 assert.match(JSON.stringify(plan),/channel_message_metric_period/);
 console.log(JSON.stringify({fixture:'10000 historical messages, isolated test database',readAndExplainMs:Math.round(performance.now()-start),returnedBytes:Buffer.byteLength(JSON.stringify(result)),replies:result.replies,failed:result.failed}));
});
