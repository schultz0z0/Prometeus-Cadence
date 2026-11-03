import test,{after}from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';
import{prospectingUser as createUser,testAdmin,closeProspectingPools,grantTestLease,configureProspectingTest}from'./prospecting-helpers.ts';
import{base,resetRateLimits}from'./helpers.ts';
import{storeConnectorSecret,connectIntegration,listConnections,disconnectIntegration}from'../../src/server/integrations/connections.ts';
import{prepareJob,confirmJob,getJob}from'../../src/server/prospecting/service.ts';
import{runGeneration}from'../../src/server/prospecting/steps.ts';
import{ApolloAdapter}from'../../src/server/prospecting/providers/apollo.ts';
import{integrationsRequest,credentialsRequest,integrationItemRequest}from'../../src/server/integrations/http.ts';
import type{Principal}from'../../src/domain/workspace.ts';
after(closeProspectingPools);
configureProspectingTest();
const prospectingUser=async()=>{await resetRateLimits();return createUser();};
const KEY='apollo-customer-key-'+'a'.repeat(12),valid=async()=>'valid' as const;
async function connect(p:Principal,key=KEY,expectedRevision=0){const {credentialRef}=await storeConnectorSecret(p,{kind:'apollo',secret:key});return connectIntegration(p,{kind:'apollo',name:'[RE] Conta Apollo',credentialRef,expectedRevision},{verify:valid});}
const connections=(ws:string)=>testAdmin(async c=>Number((await c.query("SELECT count(*) FROM app.integration_connection WHERE workspace_id=$1 AND state<>'revoked'",[ws])).rows[0].count));
const apolloInput=()=>({kind:'generation' as const,source:'APOLLO' as const,destination:{mode:'new' as const,name:'[RE] Apollo'},filters:{term:'clínicas',location:'São Paulo'},limit:5,dedupScope:'workspace' as const});
const recordingApollo=()=>{const keys:string[]=[];const adapter=new ApolloAdapter(async(_url,init)=>{keys.push(String((init?.headers as Record<string,string>)['x-api-key']));return Response.json({organizations:[],pagination:{total_pages:1}});});return{keys,adapter};};

test('credential references are single-use, owner-bound and expiring; the key never comes back in any view',async()=>{
 const u=await prospectingUser(),v=await prospectingUser(),mate={...v.p,workspaceId:u.p.workspaceId};
 await testAdmin(c=>c.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',[randomUUID(),mate.workspaceId,mate.userId,'admin']));
 const {credentialRef}=await storeConnectorSecret(u.p,{kind:'apollo',secret:KEY});
 await assert.rejects(connectIntegration(mate,{kind:'apollo',name:'x',credentialRef,expectedRevision:0},{verify:valid}),{status:403});
 await assert.rejects(connectIntegration(v.p,{kind:'apollo',name:'x',credentialRef,expectedRevision:0},{verify:valid}),{status:403});
 const conn=await connectIntegration(u.p,{kind:'apollo',name:'[RE] Conta',credentialRef,expectedRevision:0},{verify:valid});
 assert.equal(conn.state,'ready');assert.deepEqual(conn.capabilities,['companies.search']);
 await assert.rejects(connectIntegration(u.p,{kind:'apollo',name:'x',credentialRef,expectedRevision:conn.revision},{verify:valid}),{status:409,code:'CREDENTIAL_USED'});
 const late=await storeConnectorSecret(u.p,{kind:'apollo',secret:KEY});await testAdmin(c=>c.query("UPDATE app.connector_credential_ref SET expires_at=now()-interval '1 second' WHERE id=$1",[late.credentialRef]));
 await assert.rejects(connectIntegration(u.p,{kind:'apollo',name:'x',credentialRef:late.credentialRef,expectedRevision:conn.revision},{verify:valid}),{status:409});
 assert.equal(await connections(u.p.workspaceId),1);assert.equal(await connections(v.p.workspaceId),0);
 assert.doesNotMatch(JSON.stringify(await listConnections(u.p)),new RegExp(KEY));
 const stored=await testAdmin(async c=>JSON.stringify((await c.query('SELECT secret FROM app.integration_connection WHERE workspace_id=$1',[u.p.workspaceId])).rows));assert.doesNotMatch(stored,new RegExp(KEY));
 // A consumed reference keeps no copy of the key.
 assert.deepEqual(await testAdmin(async c=>(await c.query("SELECT secret FROM app.connector_credential_ref WHERE id=$1",[credentialRef])).rows[0].secret),{});
});

test('a refused or unverifiable key creates no connection; replacing a key needs the current revision',async()=>{
 const{p}=await prospectingUser();
 for(const verdict of['refused','unavailable'] as const){const {credentialRef}=await storeConnectorSecret(p,{kind:'apollo',secret:KEY});
  await assert.rejects(connectIntegration(p,{kind:'apollo',name:'x',credentialRef,expectedRevision:0},{verify:async()=>verdict}),{status:verdict==='refused'?422:503});}
 assert.equal(await connections(p.workspaceId),0);
 const first=await connect(p);await assert.rejects(connect(p,KEY+'b',0),{status:409});
 const second=await connect(p,KEY+'b',first.revision);assert.equal(second.id,first.id);assert.equal(second.revision,first.revision+1);
});

test("Apollo generation uses the workspace's own key, never another workspace's; revoking before the call stops it",async()=>{
 const a=await prospectingUser(),b=await prospectingUser();
 const reviewB=await prepareJob(b.p,apolloInput());assert.ok(reviewB.blockers.length>0,'without a connection or central key Apollo is not ready');
 await connect(a.p);
 const review=await prepareJob(a.p,apolloInput());assert.deepEqual(review.blockers,[]);
 const job=await confirmJob(a.p,{requestId:randomUUID(),input:apolloInput(),reviewToken:review.token});
 const r=recordingApollo();await runGeneration(await grantTestLease(a.p,job.id),{apollo:r.adapter});
 assert.deepEqual(r.keys,[KEY]);
 assert.ok(['completed','partial'].includes((await getJob(a.p,job.id)).state));
 // A key revoked after confirmation is never used: the step fails before any request.
 const review2=await prepareJob(a.p,apolloInput()),job2=await confirmJob(a.p,{requestId:randomUUID(),input:apolloInput(),reviewToken:review2.token});
 const [live]=(await listConnections(a.p)).connections;await disconnectIntegration(a.p,live.id,{expectedRevision:live.revision});
 const r2=recordingApollo();await runGeneration(await grantTestLease(a.p,job2.id),{apollo:r2.adapter}).catch(()=>{});
 assert.deepEqual(r2.keys,[]);assert.notEqual((await getJob(a.p,job2.id)).state,'completed');
 // Reconnecting with the old review is refused: the connection revision is part of the proof.
 await connect(a.p,KEY,0);await assert.rejects(confirmJob(a.p,{requestId:randomUUID(),input:apolloInput(),reviewToken:review2.token}),{status:409});
});

test('connector management is owner/admin only; HTTP contract keeps the key out of responses',async()=>{
 const u=await prospectingUser(),v=await prospectingUser(),mate={...v.p,workspaceId:u.p.workspaceId,role:'operator' as const};
 await testAdmin(c=>c.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',[randomUUID(),mate.workspaceId,mate.userId,'operator']));
 await assert.rejects(storeConnectorSecret(mate,{kind:'apollo',secret:KEY}),{status:403});
 await assert.rejects(storeConnectorSecret(u.p,{kind:'funnelsflow',secret:KEY}),{status:422});
 assert.equal((await credentialsRequest(new Request(base+'/api/integrations/credentials',{method:'POST',body:'{}'}))).status,401);
 const noOrigin=new Headers(u.headers);noOrigin.delete('origin');
 assert.equal((await credentialsRequest(new Request(base+'/api/integrations/credentials',{method:'POST',headers:noOrigin,body:JSON.stringify({kind:'apollo',secret:KEY})}))).status,403);
 const stored=await credentialsRequest(new Request(base+'/api/integrations/credentials',{method:'POST',headers:u.headers,body:JSON.stringify({kind:'apollo',secret:KEY})}));
 const ref=await stored.json();assert.equal(stored.status,200);assert.doesNotMatch(JSON.stringify(ref),new RegExp(KEY));
 const listed=await integrationsRequest(new Request(base+'/api/integrations?view=connections',{headers:u.headers}));assert.equal(listed.status,200);
 const body=await listed.json();assert.equal(body.catalog.find((c:{kind:string})=>c.kind==='apollo').available,true);assert.equal(body.catalog.find((c:{kind:string})=>c.kind==='funnelsflow').available,false);
 assert.equal((await integrationItemRequest(new Request(base+'/api/integrations/'+randomUUID()+'/disconnect',{method:'POST',headers:u.headers,body:JSON.stringify({expectedRevision:1})}),randomUUID(),'disconnect')).status,404);
});
