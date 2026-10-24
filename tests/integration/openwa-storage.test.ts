import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {getPools} from '../../src/server/db/pool.ts';import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {dispatchPool,closeDispatchPool} from '../../src/server/messaging/worker-db.ts';
import {createOpenwaRecord,readOpenwaRecord} from '../../src/server/channels/openwa/repository.ts';
import {openwaFixture,openwaInput,whatsappUser,testAdmin} from './openwa-helpers.ts';
after(async()=>{await Promise.all([getPools().close(),closeDispatchPool()]);});
test('managed creation is idempotent, tenant-bound and never discloses remote authority',async()=>{
 const {u,input,view,id}=await openwaFixture(),b=await whatsappUser();
 assert.deepEqual(await createOpenwaRecord(u.p,input),view);
 await assert.rejects(createOpenwaRecord(u.p,{...input,name:'Other'}),{status:409});
 assert.equal(view.phase,'provisioning');assert.equal(view.connection.provider,'openwa');assert.equal(view.platformDailyCap,20);
 assert.equal(view.connection.externalAccountId,null);assert.deepEqual(view.connection.identifiers,{});
 await assert.rejects(readOpenwaRecord(b.p,id),{status:404});
 const row=await testAdmin(async c=>(await c.query('SELECT remote_name,remote_session_id FROM app.openwa_connection WHERE connection_id=$1',[id])).rows[0]);
 assert.equal(row.remote_name,`pc-${id}`);assert.equal(row.remote_session_id,null);
 assert.equal(JSON.stringify(view).includes('webhookSecret'),false);
 await withWorkspaceTransaction(u.p,c=>assert.rejects(c.query('SELECT * FROM app.channel_credential'),{code:'42501'}));
 await testAdmin(c=>c.query('UPDATE auth.member SET role=$3 WHERE "organizationId"=$1 AND "userId"=$2',[u.p.workspaceId,u.p.userId,'operator']));
 await assert.rejects(createOpenwaRecord(u.p,openwaInput()),{status:403});
 await assert.rejects(readOpenwaRecord(u.p,id),{status:403});
});
test('remote session uniqueness and composite foreign key forbid cross-workspace adoption',async()=>{
 const a=await openwaFixture(),b=await openwaFixture(),session=randomUUID();
 await testAdmin(c=>c.query('UPDATE app.openwa_connection SET remote_session_id=$2 WHERE connection_id=$1',[a.id,session]));
 await assert.rejects(testAdmin(c=>c.query('UPDATE app.openwa_connection SET remote_session_id=$2 WHERE connection_id=$1',[b.id,session])),{code:'23505'});
 await assert.rejects(testAdmin(c=>c.query('UPDATE app.openwa_connection SET workspace_id=$2 WHERE connection_id=$1',[b.id,a.u.p.workspaceId])),{code:'23503'});
});
test('only fenced dispatcher leases can finish, and revoked requesting membership blocks continuation',async()=>{
 const fixture=await openwaFixture();
 // Keep claim deterministic without changing another workspace's state.
 await testAdmin(c=>c.query("UPDATE app.openwa_connection SET next_at=clock_timestamp()+interval '1 day' WHERE connection_id<>$1",[fixture.id]));
 const lease=(await dispatchPool().query('SELECT app.claim_openwa_operation(clock_timestamp()) AS value')).rows[0].value;
 assert.equal(lease.connectionId,fixture.id);
 await assert.rejects(dispatchPool().query('SELECT app.read_openwa_operation($1,$2,$3,$4)',[lease.workspaceId,lease.connectionId,randomUUID(),lease.fence]),/STALE_OPENWA_LEASE/);
 await withWorkspaceTransaction(fixture.u.p,c=>assert.rejects(c.query('SELECT app.claim_openwa_operation(clock_timestamp())'),{code:'42501'}));
 await assert.rejects(dispatchPool().query('SELECT * FROM app.openwa_connection'),{code:'42501'});
 await assert.rejects(dispatchPool().query('SELECT * FROM app.channel_credential'),{code:'42501'});
 await testAdmin(c=>c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[fixture.u.p.workspaceId,fixture.u.p.userId]));
 await assert.rejects(dispatchPool().query('SELECT app.finish_openwa_operation($1,$2,$3,$4,$5)',[lease.workspaceId,lease.connectionId,lease.token,lease.fence,{kind:'session',sessionId:randomUUID()}]),/OPENWA_AUTHORITY_REVOKED/);
});
