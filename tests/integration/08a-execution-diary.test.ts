import test, {after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {getPools} from '../../src/server/db/pool.ts';
import {readWorkspaceSnapshot} from '../../src/server/workspaces/commands.ts';
import {decodeDemoState} from '../../src/demo/storage.ts';
import {base,resetRateLimits} from './helpers.ts';
import {prospectingUser,testAdmin} from './prospecting-helpers.ts';
import {seedExecutionDiary} from '../manual/execution-diary-fixture.mjs';

beforeEach(resetRateLimits);
after(() => getPools().close());

test('diário lê mensagens de cadência, pagina e filtra dentro do workspace', async () => {
  const user = await prospectingUser({billing:false,qaName:'[RE] Diário'});
  const another = await prospectingUser({billing:false,qaName:'[RE] Outro workspace'});
  const fixture = await testAdmin(async client => {
    const db = {connect:async () => ({query:client.query.bind(client),release:()=>{}})};
    return seedExecutionDiary(db,user.p.workspaceId,user.p.userId,27);
  });
  const snapshot = await readWorkspaceSnapshot(user.p);
  assert.equal(decodeDemoState(JSON.stringify(snapshot.data)).ok,true,'a fixture deve ser legível pelo shell');
  const path = '/api/execution-diary';
  const {GET} = await import('../../src/app/api/execution-diary/route.ts');
  const get = (query='',headers:HeadersInit=user.headers) => GET(new Request(base+path+query,{headers}));
  const first = await get('?size=25');
  assert.equal(first.status,200);
  assert.equal(first.headers.get('cache-control'),'no-store');
  const data = await first.json();
  assert.equal(data.total,27);
  assert.deepEqual(data.counts,{success:9,error:9,skipped:9,progress:0});
  assert.deepEqual(data.items.map((item:{id:string})=>item.id),fixture.ids.slice(0,25));
  assert.deepEqual((await (await get('?size=25&page=2')).json()).items.map((item:{id:string})=>item.id),fixture.ids.slice(25));
  assert.equal((await (await get('?size=25&page=50')).json()).page,2);
  assert.ok(!JSON.stringify(data).includes('Texto interno'));
  assert.equal((await (await get('?q='+encodeURIComponent(fixture.leadName)+'&status=skipped&channel=EMAIL')).json()).total,9);
  assert.equal((await (await get('?q=contato%20j%C3%A1%20respondeu')).json()).total,9);
  assert.equal((await (await get('?q=%25')).json()).total,0);
  assert.equal((await (await get('?channel=WHATSAPP')).json()).total,0);
  assert.equal((await (await get('',another.headers)).json()).total,0);
  assert.equal((await get('',new Headers())).status,401);
  assert.equal((await get('?size=25&size=50')).status,422);
  const mismatch = new Headers(user.headers);
  mismatch.set('x-cadence-workspace',another.p.workspaceId);
  assert.equal((await get('',mismatch)).status,409);
  await testAdmin(c=>c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[user.p.workspaceId,user.p.userId]));
  assert.equal((await get()).status,403);
});

test('diário distingue mensagens adiadas e tentativa incerta, e aplica período local', async () => {
  const user = await prospectingUser({billing:false,qaName:'[RE] Rastreio'});
  const fixture = await testAdmin(async client => {
    const db = {connect:async () => ({query:client.query.bind(client),release:()=>{}})};
    const data = await seedExecutionDiary(db,user.p.workspaceId,user.p.userId);
    const [uncertain,limited,old] = data.ids;
    await client.query("UPDATE app.message_outbox SET state='uncertain',accepted_at=NULL WHERE message_id=$1",[uncertain]);
    await client.query("UPDATE app.channel_message SET state='uncertain',accepted_at=NULL WHERE id=$1",[uncertain]);
    await client.query("INSERT INTO app.message_dispatch_attempt (workspace_id,id,message_id,attempt_number,fence,lease_token,state,outcome) VALUES ($1,$2,$3,1,1,'[RE] lease expirado','uncertain',$4)",[user.p.workspaceId,randomUUID(),uncertain,{internal:'[RE] diagnóstico interno'}]);
    // Só no PostgreSQL efêmero. A cadência permanece pausada e o canal desconectado.
    await client.query("UPDATE app.message_outbox SET state='pending',blocked_code='EMAIL_DAILY_LIMIT' WHERE message_id=$1",[limited]);
    await client.query("UPDATE app.channel_message SET state='pending' WHERE id=$1",[limited]);
    await client.query("UPDATE app.channel_message SET created_at=now()-interval '31 days' WHERE id=$1",[old]);
    await client.query("INSERT INTO app.workspace_preferences VALUES($1,$2) ON CONFLICT (workspace_id) DO UPDATE SET payload=EXCLUDED.payload",[user.p.workspaceId,{timezone:'America/Sao_Paulo'}]);
    return data;
  });
  const {GET} = await import('../../src/app/api/execution-diary/route.ts');
  async function get(query:string) {
    const response=await GET(new Request(base+'/api/execution-diary?'+query,{headers:user.headers}));
    assert.equal(response.status,200);
    return response.json();
  }
  const essential = await get('period=30');
  assert.equal(essential.timezone,'America/Sao_Paulo');
  assert.equal(essential.total,2);
  assert.deepEqual(essential.counts,{success:0,error:1,skipped:0,progress:1});
  assert.match(essential.items.find((item:{id:string})=>item.id===fixture.ids[0]).event,/sem confirmação/i);
  assert.match(essential.items.find((item:{id:string})=>item.id===fixture.ids[1]).event,/limite diário/i);
  const trace = await get('period=30&detail=trace');
  assert.equal(trace.total,3);
  assert.deepEqual(trace.counts,essential.counts);
  assert.deepEqual(trace.items.filter((item:{trace:boolean})=>item.trace).map((item:{event:string})=>item.event),['Tentativa 1: sem confirmação']);
  assert.ok(!JSON.stringify(trace).includes('diagnóstico interno'));

  await testAdmin(async c=>{
    await c.query("UPDATE app.workspace_preferences SET payload=$2 WHERE workspace_id=$1",[user.p.workspaceId,{timezone:'Pacific/Kiritimati'}]);
    await c.query(`UPDATE app.channel_message
      SET created_at=((now() AT TIME ZONE 'Pacific/Kiritimati')::date::timestamp AT TIME ZONE 'Pacific/Kiritimati')
        - CASE WHEN id=$2 THEN interval '1 millisecond' ELSE interval '0 milliseconds' END
      WHERE workspace_id=$1 AND id IN ($2,$3)`,[user.p.workspaceId,fixture.ids[2],fixture.ids[1]]);
  });
  const today = await get('period=today');
  const todayIds = today.items.map((item:{id:string})=>item.id);
  assert.ok(todayIds.includes(fixture.ids[1]),'local midnight is included');
  assert.ok(!todayIds.includes(fixture.ids[2]),'one millisecond before local midnight is excluded');
});
