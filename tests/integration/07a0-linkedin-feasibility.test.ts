import test,{after,beforeEach}from'node:test';import assert from'node:assert/strict';
import{prospectingUser as createUser,testAdmin,closeProspectingPools}from'./prospecting-helpers.ts';
import{base,resetRateLimits}from'./helpers.ts';
import{withWorkspaceTransaction}from'../../src/server/db/transaction.ts';
import{readLinkedinCapabilities,requireLinkedinCapability,attestLinkedinAdapter,revokeLinkedinAdapter}from'../../src/server/linkedin/capabilities.ts';
import{linkedinCapabilitiesRequest}from'../../src/server/linkedin/http.ts';
import{NO_LINKEDIN}from'../../src/domain/linkedin-capabilities.ts';
import type{Principal}from'../../src/domain/workspace.ts';
after(closeProspectingPools);
beforeEach(()=>testAdmin(c=>c.query('DELETE FROM app.linkedin_capability_profile')));
const user=async(o:{platformAi?:boolean}={})=>{await resetRateLimits();return createUser(o);};
const rows=()=>testAdmin(async c=>Number((await c.query('SELECT count(*) n FROM app.linkedin_capability_profile')).rows[0].n));
const future=(days=30)=>new Date(Date.now()+days*864e5).toISOString();
const attestation=(over:Record<string,unknown>={})=>({adapterId:'linkedin-official',kind:'official',agreementRef:'Sign In with LinkedIn (OIDC) self-service',expiresAt:future(),
 capabilities:{...NO_LINKEDIN,version:'oidc-1',connect:true,verifiedAt:new Date().toISOString()},evidenceRefs:{connect:['docs/validation/07a0-linkedin-feasibility.md']},expectedRevision:0,...over});
const gate=(p:Principal,key:Parameters<typeof requireLinkedinCapability>[1])=>withWorkspaceTransaction(p,c=>requireLinkedinCapability(c,key));
const code=async(fn:()=>Promise<unknown>)=>{try{await fn();return 'ok';}catch(e){const x=e as {status?:number;code?:string};return `${x.status}${x.code?' '+x.code:''}`;}};

test('07A.0 no adapter: every LinkedIn action is blocked with a reason; nothing is a success',async()=>{
 const {p}=await user();const view=await readLinkedinCapabilities(p);
 assert.deepEqual(view.capabilities,NO_LINKEDIN);assert.equal(view.adapter,null);assert.match(view.reason,/Nenhum fornecedor/);
 for(const a of view.actions.filter(a=>a.capability!=='local'))assert.equal(a.allowed,false,a.id);
 assert.equal(await code(()=>gate(p,'connect')),'409 LINKEDIN_UNAVAILABLE');
});

test('07A.0 OAuth login alone leaves invite and message off for every workspace',async()=>{
 const admin=await user({platformAi:true}),other=await user();
 const saved=await attestLinkedinAdapter(admin.p,attestation());assert.equal(saved.adapter?.revision,1);
 const view=await readLinkedinCapabilities(other.p);
 assert.equal(view.capabilities.connect,true);assert.equal(view.capabilities.invite,false);assert.equal(view.capabilities.sendMessage,'unavailable');
 assert.equal(JSON.stringify(view).includes('Sign In with LinkedIn'),false,'agreement and evidence stay on the server');
 assert.equal(await code(()=>gate(other.p,'connect')),'ok');
 for(const k of ['audience','invite','acceptance','readMessages','sendMessage','scheduledMessage','profileVisit','like','comment'] as const)assert.equal(await code(()=>gate(other.p,k)),'409 LINKEDIN_UNAVAILABLE',k);
});

test('07A.0 official Messages cannot be automatic even for a valid platform admin; non-admin cannot attest',async()=>{
 const admin=await user({platformAi:true}),owner=await user();
 const automatic=attestation({capabilities:{...NO_LINKEDIN,version:'x',sendMessage:'automatic',verifiedAt:null},evidenceRefs:{sendMessage:['d']}});
 assert.equal(await code(()=>attestLinkedinAdapter(admin.p,automatic)),'422');
 assert.equal(await code(()=>attestLinkedinAdapter(admin.p,attestation({evidenceRefs:{}}))),'422');
 assert.equal(await code(()=>attestLinkedinAdapter(owner.p,attestation())),'403 PLATFORM_ADMIN_REQUIRED');
 assert.equal(await rows(),0);
 const assisted=await attestLinkedinAdapter(admin.p,attestation({capabilities:{...NO_LINKEDIN,version:'x',sendMessage:'assisted',verifiedAt:null},evidenceRefs:{sendMessage:['d']}}));
 assert.equal(assisted.capabilities.sendMessage,'assisted');
 assert.equal(await code(()=>gate(owner.p,'sendMessage')),'ok');
 assert.equal(await code(()=>gate(owner.p,'scheduledMessage')),'409 LINKEDIN_UNAVAILABLE');
});

test('07A.0 expired or revoked attestation blocks the gate at once; revisions and a second active adapter conflict',async()=>{
 const admin=await user({platformAi:true}),{p}=await user();
 const connector=attestation({adapterId:'qa-connector',kind:'account-connector',capabilities:{...NO_LINKEDIN,version:'c1',connect:true,invite:true,verifiedAt:null},evidenceRefs:{connect:['a'],invite:['b']}});
 await attestLinkedinAdapter(admin.p,connector);assert.equal(await code(()=>gate(p,'invite')),'ok');
 assert.equal(await code(()=>attestLinkedinAdapter(admin.p,attestation())),'409 ADAPTER_ACTIVE');
 assert.equal(await code(()=>attestLinkedinAdapter(admin.p,connector)),'409 REVISION_CONFLICT');
 const renewed=await attestLinkedinAdapter(admin.p,{...connector,expectedRevision:1});assert.equal(renewed.adapter?.revision,2);
 await testAdmin(c=>c.query("UPDATE app.linkedin_capability_profile SET expires_at=now()-interval '1 second'"));
 assert.equal(await code(()=>gate(p,'invite')),'409 LINKEDIN_UNAVAILABLE');
 const expired=await readLinkedinCapabilities(p);assert.deepEqual(expired.capabilities,NO_LINKEDIN);assert.match(expired.reason,/venceu/);
 await testAdmin(c=>c.query("UPDATE app.linkedin_capability_profile SET expires_at=now()+interval '1 day'"));
 assert.equal(await code(()=>revokeLinkedinAdapter(admin.p,{adapterId:'qa-connector',expectedRevision:1})),'409 REVISION_CONFLICT');
 assert.equal(await code(()=>revokeLinkedinAdapter(p,{adapterId:'qa-connector',expectedRevision:2})),'403 PLATFORM_ADMIN_REQUIRED');
 await revokeLinkedinAdapter(admin.p,{adapterId:'qa-connector',expectedRevision:2});
 assert.equal(await code(()=>gate(p,'invite')),'409 LINKEDIN_UNAVAILABLE');
 const revoked=await readLinkedinCapabilities(p);assert.equal(revoked.adapter,null);assert.match(revoked.reason,/revogad/);
 assert.equal((await attestLinkedinAdapter(admin.p,attestation())).adapter?.id,'linkedin-official','a revoked adapter frees the slot');
});

test('07A.0 the app role cannot read or write the profile table directly',async()=>{
 const {p}=await user();
 assert.match(await code(()=>withWorkspaceTransaction(p,c=>c.query('SELECT * FROM app.linkedin_capability_profile'))),/undefined/);
 assert.match(await code(()=>withWorkspaceTransaction(p,c=>c.query("INSERT INTO app.linkedin_capability_profile(adapter_id) VALUES('x')"))),/undefined/);
});

test('07A.0 HTTP contract: 401 anonymous, 403 non-admin, 422 invalid, 409 workspace changed, member GET without secrets',async()=>{
 const admin=await user({platformAi:true}),member=await user();const url=base+'/api/linkedin/capabilities';
 const call=(h:Headers|null,method='GET',body?:unknown)=>linkedinCapabilitiesRequest(new Request(url,{method,headers:h??new Headers({origin:base}),body:body?JSON.stringify(body):undefined}));
 assert.equal((await call(null)).status,401);
 const get=await call(member.headers);assert.equal(get.status,200);const body=await get.json();assert.equal(body.capabilities.connect,false);assert.equal(get.headers.get('cache-control'),'no-store');
 assert.equal((await call(member.headers,'POST',{action:'attest',input:attestation()})).status,403);
 assert.equal((await call(admin.headers,'POST',{action:'attest',input:{...attestation(),adapterId:'Bad Id'}})).status,422);
 assert.equal((await call(admin.headers,'POST',{action:'nope'})).status,422);
 const moved=new Headers(admin.headers);moved.set('x-cadence-workspace',member.p.workspaceId);
 assert.equal((await call(moved,'POST',{action:'attest',input:attestation()})).status,409);
 const ok=await call(admin.headers,'POST',{action:'attest',input:attestation()});assert.equal(ok.status,200);
 assert.equal((await call(admin.headers,'POST',{action:'revoke',input:{adapterId:'linkedin-official',expectedRevision:1}})).status,200);
 assert.equal(await rows(),1,'revocation keeps the record');
});
