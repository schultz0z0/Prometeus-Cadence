import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {publicationFixture} from './messaging-helpers.ts';import {prospectingUser,configureProspectingTest} from './prospecting-helpers.ts';
import {saveAiPolicy} from '../../src/server/prospecting/ai/settings.ts';import {preparePublication,confirmPublication} from '../../src/server/messaging/publication.ts';
import {materializeDueMessages} from '../../src/server/messaging/outbox.ts';import {claimDispatch,leaseArgs} from '../../src/server/messaging/lease.ts';
import {dispatchPool,closeDispatchPool} from '../../src/server/messaging/worker-db.ts';import {getPools} from '../../src/server/db/pool.ts';import {closeIngressPool} from '../../src/server/channels/ingress-db.ts';
configureProspectingTest();after(async()=>{await getPools().close();await closeDispatchPool();await closeIngressPool();});
test('a customer cadence dispatch reads the central policy revision and a concurrent admin change invalidates the SQL guard',async()=>{
 const admin=await prospectingUser({platformAi:true}),f=await publicationFixture(),policy={mode:'conventional-only' as const,conventionalProvider:'openai' as const,jevEnabled:false};
 await saveAiPolicy(admin.p,{requestId:randomUUID(),expectedRevision:0,policy});
 const review=await preparePublication(f.u.p,f.input);assert.deepEqual(review.blockers,[]);assert.equal(review.snapshot.aiRouteRevision,1);
 await confirmPublication(f.u.p,{...f.input,requestId:randomUUID(),reviewToken:review.token});
 const now=new Date(f.now.getTime()+120000).toISOString();assert.equal(await materializeDueMessages(now,100,f.u.p.workspaceId),1);
 const lease=await claimDispatch(now,{workspaceId:f.u.p.workspaceId});assert.ok(lease);
 const before=(await dispatchPool().query('SELECT app.read_message_dispatch($1,$2,$3,$4) AS ctx',leaseArgs(lease))).rows[0].ctx;assert.equal(before.aiRevision,1);
 await saveAiPolicy(admin.p,{requestId:randomUUID(),expectedRevision:1,policy});
 const after=(await dispatchPool().query('SELECT app.read_message_dispatch($1,$2,$3,$4) AS ctx',leaseArgs(lease))).rows[0].ctx;assert.equal(after.aiRevision,2);
 const begin=(await dispatchPool().query('SELECT app.begin_message_dispatch($1,$2,$3,$4,$5,$6,$7) AS result',[lease.workspaceId,lease.messageId,lease.attemptId,lease.token,lease.fence,before.guard,now])).rows[0].result;assert.equal(begin.allowed,false);
});
