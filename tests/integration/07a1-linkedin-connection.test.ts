import test,{after,before,beforeEach}from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';
import{prospectingUser as createUser,testAdmin,closeProspectingPools}from'./prospecting-helpers.ts';
import{base,resetRateLimits}from'./helpers.ts';
import{withWorkspaceTransaction}from'../../src/server/db/transaction.ts';
import{attestLinkedinAdapter}from'../../src/server/linkedin/capabilities.ts';
import{readLinkedinAccount,prepareLinkedinConnection,confirmLinkedinConnection,finishLinkedinReturn,receiveLinkedinNotify,syncLinkedinAccount,revokeLinkedinAccount,runLinkedinTick}from'../../src/server/linkedin/connections.ts';
import{linkedinAccountsRequest,linkedinAccountActionRequest,linkedinNotifyRequest,linkedinCallbackRequest}from'../../src/server/linkedin/http.ts';
import{NO_LINKEDIN}from'../../src/domain/linkedin-capabilities.ts';
import{LINKEDIN_TERMS}from'../../src/domain/linkedin-connection.ts';
import{closeIngressPool}from'../../src/server/channels/ingress-db.ts';
import type{Principal}from'../../src/domain/workspace.ts';
after(async()=>{await closeIngressPool();await closeProspectingPools();});
const env={UNIPILE_DSN:'api9.unipile.com:13111',UNIPILE_API_KEY:'unipile-key-qa-'+'k'.repeat(20)},saved:Record<string,string|undefined>={};
before(()=>{for(const [k,v] of Object.entries(env)){saved[k]=process.env[k];process.env[k]=v;}});
after(()=>{for(const k of Object.keys(env)){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}});
beforeEach(()=>testAdmin(async c=>{await c.query('DELETE FROM app.linkedin_capability_profile');}));
const user=async(o:{platformAi?:boolean}={})=>{await resetRateLimits();return createUser(o);};
const code=async(fn:()=>Promise<unknown>)=>{try{await fn();return 'ok';}catch(e){const x=e as {status?:number;code?:string};return `${x.status}${x.code?' '+x.code:''}`;}};
const future=(days=30)=>new Date(Date.now()+days*864e5).toISOString();
async function enable(adapterId='unipile',expectedRevision=0){
 const admin=await user({platformAi:true});
 await attestLinkedinAdapter(admin.p,{adapterId,kind:'account-connector',agreementRef:'QA fixture',expiresAt:future(),capabilities:{...NO_LINKEDIN,version:'unipile-qa',connect:true,verifiedAt:null},evidenceRefs:{connect:['qa']},expectedRevision});
 return admin;
}
const accept=(o:Record<string,unknown>={})=>({termsVersion:LINKEDIN_TERMS.version,acceptTerms:true,expectedRevision:0,...o});

/** In-memory Unipile: hosted links, accounts by id, delete. Every call is recorded. */
function fakeUnipile(owner?:Principal){
 const accounts=new Map<string,{name:string;memberId:string;statuses:string[];type?:string}>(),links:Record<string,any>[]=[],calls:string[]=[];
 const hooks:{offline?:boolean;duringGet?:()=>Promise<unknown>;deleteFails?:boolean;linkFails?:boolean;retryAfter?:string}={};
 const fakeFetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input)),method=init?.method??'GET';
  assert.equal(url.origin,'https://api9.unipile.com:13111');assert.equal((init?.headers as Record<string,string>)['x-api-key'],env.UNIPILE_API_KEY);
  calls.push(method+' '+url.pathname);if(hooks.offline)throw new TypeError('fetch failed');
  if(method==='POST'&&url.pathname==='/api/v1/hosted/accounts/link'){if(hooks.linkFails)return Response.json({},{status:503});links.push(JSON.parse(String(init?.body)));return Response.json({object:'HostedAuthURL',url:'https://account.unipile.com/qa-'+links.length},{status:201});}
  const m=url.pathname.match(/^\/api\/v1\/accounts\/([A-Za-z0-9_-]+)$/);if(!m)return Response.json({},{status:404});
  const a=accounts.get(m[1]);
  if(method==='DELETE'){if(hooks.deleteFails)return Response.json({},{status:500});accounts.delete(m[1]);return Response.json({object:'AccountDeleted'});}
  await hooks.duringGet?.();
  if(hooks.retryAfter)return Response.json({},{status:429,headers:{'retry-after':hooks.retryAfter}});
  if(!a)return Response.json({status:404,type:'errors/resource_not_found'},{status:404});
  return Response.json({object:'Account',type:a.type??'LINKEDIN',id:m[1],name:a.name,created_at:new Date().toISOString(),connection_params:{im:{id:a.memberId,publicIdentifier:'re-'+a.memberId}},groups:[],sources:a.statuses.map((status,i)=>({id:m[1]+'_'+i,status}))});
 }) as typeof fetch;
 return{owner,accounts,links,calls,hooks,deps:{fetch:fakeFetch},count:(c:string)=>calls.filter(x=>x===c).length};
}
const notifyToken=(link:Record<string,any>)=>new URL(link.notify_url).searchParams.get('token')!;
const returnState=(link:Record<string,any>)=>new URL(link.success_redirect_url).searchParams.get('state')!;
/** The person finishes the Unipile login: the vendor creates the account and calls notify_url, and the starter's browser comes back. */
async function completeLogin(u:ReturnType<typeof fakeUnipile>,link:Record<string,any>,o:{id?:string;memberId?:string;status?:string}={}){
 const id=o.id??'acc_'+randomUUID().replaceAll('-','').slice(0,18);
 if(!u.accounts.has(id))u.accounts.set(id,{name:'[RE] Pessoa LinkedIn',memberId:o.memberId??'ACo'+randomUUID().slice(0,8),statuses:['OK']});
 await receiveLinkedinNotify(notifyToken(link),{status:o.status??'CREATION_SUCCESS',account_id:id,name:link.name},u.deps);
 if(u.owner)await finishLinkedinReturn(u.owner,u.owner.sessionId,new URL(link.success_redirect_url));
 return id;
}
async function connected(platform=true){
 if(platform)await enable();const owner=await user(),u=fakeUnipile(owner.p);
 await confirmLinkedinConnection(owner.p,owner.p.sessionId,accept(),u.deps);
 const externalId=await completeLogin(u,u.links[0]);
 const account=(await readLinkedinAccount(owner.p)).account!;
 return{...owner,u,externalId,account};
}
const accountRow=(ws:string)=>testAdmin(async c=>(await c.query("SELECT * FROM app.linkedin_account WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 1",[ws])).rows[0]);
const events=(ws:string)=>testAdmin(async c=>(await c.query('SELECT kind FROM app.linkedin_account_event WHERE workspace_id=$1 ORDER BY at',[ws])).rows.map(r=>r.kind));
const setRole=(p:Principal,role:string)=>testAdmin(c=>c.query('UPDATE auth.member SET role=$3 WHERE "organizationId"=$1 AND "userId"=$2',[p.workspaceId,p.userId,role]));

test('07A.1 gate first: no adapter, a non-Unipile adapter or unaccepted terms open no link; only owner/admin connect',async()=>{
 const owner=await user(),u=fakeUnipile();
 const review=await prepareLinkedinConnection(owner.p);
 assert.equal(review.terms.version,LINKEDIN_TERMS.version);assert.match(review.blockers.join(' '),/Nenhum fornecedor/);
 assert.equal(await code(()=>confirmLinkedinConnection(owner.p,owner.p.sessionId,accept(),u.deps)),'409 LINKEDIN_UNAVAILABLE');
 await enable('linked-api');
 assert.equal(await code(()=>confirmLinkedinConnection(owner.p,owner.p.sessionId,accept(),u.deps)),'409 LINKEDIN_UNSUPPORTED');
 await testAdmin(c=>c.query('DELETE FROM app.linkedin_capability_profile'));await enable();
 assert.deepEqual((await prepareLinkedinConnection(owner.p)).blockers,[]);
 assert.equal(await code(()=>confirmLinkedinConnection(owner.p,owner.p.sessionId,accept({acceptTerms:false}),u.deps)),'422');
 assert.equal(await code(()=>confirmLinkedinConnection(owner.p,owner.p.sessionId,accept({termsVersion:'old'}),u.deps)),'409 LINKEDIN_TERMS_CHANGED');
 await setRole(owner.p,'operator');
 assert.equal(await code(()=>confirmLinkedinConnection(owner.p,owner.p.sessionId,accept(),u.deps)),'403 CONNECTOR_ACCESS');
 assert.equal(u.links.length,0);assert.equal(u.calls.length,0);
 assert.equal((await readLinkedinAccount(owner.p)).account,null,'members still read the (empty) state');
});

test('07A.1 connect: hosted link for LinkedIn only, notify binds after the vendor confirms the account; no secret reaches the browser',async()=>{
 await enable();const owner=await user(),u=fakeUnipile();
 const started=await confirmLinkedinConnection(owner.p,owner.p.sessionId,accept(),u.deps);
 assert.equal(started.url,'https://account.unipile.com/qa-1');
 const link=u.links[0];
 assert.equal(link.type,'create');assert.deepEqual(link.providers,['LINKEDIN']);assert.equal(link.api_url,'https://api9.unipile.com:13111');
 assert.ok(Date.parse(link.expiresOn)-Date.now()<=31*60e3);
 for(const k of ['notify_url','success_redirect_url','failure_redirect_url'])assert.equal(new URL(link[k]).origin,new URL(base).origin,k);
 assert.equal(JSON.stringify(started).includes(notifyToken(link)),false,'the notify token never goes to the browser');
 assert.equal((await readLinkedinAccount(owner.p)).account,null,'nothing is connected before the vendor notifies');
 const externalId=await completeLogin(u,link);
 assert.equal(u.count('GET /api/v1/accounts/'+externalId),1,'the account is read from the vendor before binding');
 assert.equal((await readLinkedinAccount(owner.p)).account,null,'the vendor notify alone binds nothing');
 assert.equal(await code(()=>finishLinkedinReturn(owner.p,'another-session',new URL(link.success_redirect_url))),'403 OAUTH_INVALID');
 assert.equal(await finishLinkedinReturn(owner.p,owner.p.sessionId,new URL(link.success_redirect_url)),'connected');
 const view=await readLinkedinAccount(owner.p),a=view.account!;
 assert.equal(a.state,'ready');assert.equal(a.ready,true);assert.equal(a.displayName,'[RE] Pessoa LinkedIn');assert.ok(a.lastSyncAt);
 assert.equal(a.capabilities.connect,true);
 for(const secret of [externalId,notifyToken(link),returnState(link),env.UNIPILE_API_KEY])assert.equal(JSON.stringify(view).includes(secret),false);
 const row=await accountRow(owner.p.workspaceId);assert.equal(row.terms_version,LINKEDIN_TERMS.version);assert.equal(row.terms_accepted_by,owner.p.userId);
 assert.equal(await finishLinkedinReturn(owner.p,owner.p.sessionId,new URL(link.success_redirect_url)),'connected','returning again is harmless');
 assert.deepEqual(await events(owner.p.workspaceId),['connected']);
});

test('07A.1 a forwarded hosted link cannot attach someone else\'s login; the browser may come back before the notify',async()=>{
 await enable();const owner=await user(),victim=await user(),u=fakeUnipile();
 await confirmLinkedinConnection(owner.p,owner.p.sessionId,accept(),u.deps);
 const link=u.links[0],id=await completeLogin(u,link);
 // The victim finished the login, so the victim's browser holds the return; it is not the starter's session.
 assert.equal(await code(()=>finishLinkedinReturn(victim.p,victim.p.sessionId,new URL(link.success_redirect_url))),'403 OAUTH_INVALID');
 await testAdmin(c=>c.query("UPDATE app.linkedin_connect_attempt SET expires_at=clock_timestamp()-interval '1 second' WHERE workspace_id=$1",[owner.p.workspaceId]));
 assert.equal(await finishLinkedinReturn(owner.p,owner.p.sessionId,new URL(link.success_redirect_url)),'cancelled');
 assert.equal(await accountRow(owner.p.workspaceId),undefined,'never bound');
 await runLinkedinTick({limit:10},u.deps);
 assert.equal(u.count('DELETE /api/v1/accounts/'+id),1,'the unclaimed vendor session is removed');
 // Return first, notify second: binds on the notify.
 await confirmLinkedinConnection(owner.p,owner.p.sessionId,accept(),u.deps);
 const l2=u.links[1];
 assert.equal(await finishLinkedinReturn(owner.p,owner.p.sessionId,new URL(l2.success_redirect_url)),'connecting');
 await completeLogin(u,l2);
 assert.equal((await readLinkedinAccount(owner.p)).account!.state,'ready');
});

test('07A.1 a rejected create notify removes the vendor session it created, but never one that belongs to another workspace',async()=>{
 const c1=await connected(),owner=await user(),u=fakeUnipile(owner.p);u.accounts.set(c1.externalId,c1.u.accounts.get(c1.externalId)!);
 await confirmLinkedinConnection(owner.p,owner.p.sessionId,accept(),u.deps);
 await confirmLinkedinConnection(owner.p,owner.p.sessionId,accept(),u.deps);
 const stale=await code(()=>completeLogin(u,u.links[0],{id:'acc_stale00000001'}));
 assert.equal(stale,'409 LINKEDIN_NOTIFY_USED');assert.equal(u.count('DELETE /api/v1/accounts/acc_stale00000001'),1);
 assert.equal(await code(()=>completeLogin(u,u.links[1],{id:c1.externalId})),'409 LINKEDIN_ACCOUNT_TAKEN');
 assert.equal(u.count('DELETE /api/v1/accounts/'+c1.externalId),0,'another workspace\'s account is never removed');
 await testAdmin(x=>x.query('UPDATE app.linkedin_capability_profile SET revoked_at=clock_timestamp()'));
 assert.equal(await code(()=>completeLogin(u,u.links[1],{id:'acc_gateoff000001'})),'409 LINKEDIN_UNAVAILABLE');
 assert.equal(u.count('DELETE /api/v1/accounts/acc_gateoff000001'),1);
});

test('07A.1 replayed, forged, stale and cross-tenant notifies change nothing',async()=>{
 const c1=await connected(),link=c1.u.links[0];
 await receiveLinkedinNotify(notifyToken(link),{status:'CREATION_SUCCESS',account_id:c1.externalId,name:link.name},c1.u.deps);
 assert.deepEqual(await events(c1.p.workspaceId),['connected'],'the same notify again is a no-op');
 c1.u.accounts.set('acc_other0000000',{name:'Outra',memberId:'ACoOther',statuses:['OK']});
 assert.equal(await code(()=>receiveLinkedinNotify(notifyToken(link),{status:'CREATION_SUCCESS',account_id:'acc_other0000000',name:link.name},c1.u.deps)),'409 LINKEDIN_NOTIFY_USED');
 assert.equal(await code(()=>receiveLinkedinNotify('x'.repeat(43),{status:'CREATION_SUCCESS',account_id:c1.externalId,name:link.name},c1.u.deps)),'404 LINKEDIN_NOTIFY_INVALID');
 // Another workspace cannot take the same vendor account or the same LinkedIn member.
 const other=await user(),u2=c1.u;await confirmLinkedinConnection(other.p,other.p.sessionId,accept(),u2.deps);
 const l2=u2.links.at(-1)!;
 assert.equal(await code(()=>receiveLinkedinNotify(notifyToken(l2),{status:'CREATION_SUCCESS',account_id:c1.externalId,name:l2.name},u2.deps)),'409 LINKEDIN_ACCOUNT_TAKEN');
 const member=c1.u.accounts.get(c1.externalId)!.memberId;
 assert.equal(await code(()=>completeLogin(u2,l2,{id:'acc_samemember0001',memberId:member})),'409 LINKEDIN_ACCOUNT_TAKEN');
 assert.equal(await code(()=>receiveLinkedinNotify(notifyToken(l2),{status:'CREATION_SUCCESS',account_id:c1.externalId,name:'not-the-attempt'},u2.deps)),'404 LINKEDIN_NOTIFY_INVALID');
 assert.equal((await readLinkedinAccount(other.p)).account,null);
 // The browser return belongs to the session that started it.
 assert.equal(await code(()=>finishLinkedinReturn(other.p,other.p.sessionId,new URL(link.success_redirect_url))),'403 OAUTH_INVALID');
 assert.equal(await code(()=>finishLinkedinReturn(c1.p,'another-session',new URL(link.success_redirect_url))),'403 OAUTH_INVALID');
});

test('07A.1 a newer attempt, a cancelled login, an expired link, a removed author or a revoked gate bind nothing',async()=>{
 await enable();const owner=await user(),u=fakeUnipile();
 await confirmLinkedinConnection(owner.p,owner.p.sessionId,accept(),u.deps);
 await confirmLinkedinConnection(owner.p,owner.p.sessionId,accept(),u.deps);
 assert.equal(await code(()=>completeLogin(u,u.links[0])),'409 LINKEDIN_NOTIFY_USED','only the latest attempt can bind');
 assert.equal(await finishLinkedinReturn(owner.p,owner.p.sessionId,new URL(u.links[1].failure_redirect_url)),'cancelled');
 assert.equal(await code(()=>completeLogin(u,u.links[1])),'409 LINKEDIN_NOTIFY_USED','a cancelled login cannot bind later');
 await confirmLinkedinConnection(owner.p,owner.p.sessionId,accept(),u.deps);
 await testAdmin(c=>c.query("UPDATE app.linkedin_connect_attempt SET expires_at=clock_timestamp()-interval '1 second' WHERE workspace_id=$1",[owner.p.workspaceId]));
 assert.equal(await code(()=>completeLogin(u,u.links[2])),'409 LINKEDIN_NOTIFY_USED');
 await confirmLinkedinConnection(owner.p,owner.p.sessionId,accept(),u.deps);
 await setRole(owner.p,'operator');
 assert.equal(await code(()=>completeLogin(u,u.links[3])),'403 LINKEDIN_AUTHOR_REMOVED');
 await setRole(owner.p,'owner');
 await confirmLinkedinConnection(owner.p,owner.p.sessionId,accept(),u.deps);
 await testAdmin(c=>c.query('UPDATE app.linkedin_capability_profile SET revoked_at=clock_timestamp()'));
 assert.equal(await code(()=>completeLogin(u,u.links[4])),'409 LINKEDIN_UNAVAILABLE');
 assert.equal(await accountRow(owner.p.workspaceId),undefined);
});

test('07A.1 check: one I/O per request id and per lease, offline keeps state and backs off, revoke during I/O discards the result',async()=>{
 const c=await connected(),id=c.account.id,req=randomUUID(),path='GET /api/v1/accounts/'+c.externalId,before=c.u.count(path);
 c.u.accounts.get(c.externalId)!.statuses=['CREDENTIALS'];
 assert.equal((await syncLinkedinAccount(c.p,{accountId:id,requestId:req},c.u.deps)).state,'restricted');
 assert.equal((await syncLinkedinAccount(c.p,{accountId:id,requestId:req},c.u.deps)).state,'restricted');
 assert.equal(c.u.count(path),before+1,'same request id: no second vendor call');
 const view=(await readLinkedinAccount(c.p)).account!;assert.equal(view.ready,false);assert.match(view.attention??'',/Reconecte/);
 // Concurrent checks: one vendor call; the other is told to wait.
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);c.u.hooks.duringGet=()=>gate;
 const first=syncLinkedinAccount(c.p,{accountId:id,requestId:randomUUID()},c.u.deps);
 await new Promise(r=>setTimeout(r,50));
 assert.equal(await code(()=>syncLinkedinAccount(c.p,{accountId:id,requestId:randomUUID()},c.u.deps)),'409 LINKEDIN_SYNC_BUSY');
 release();await first;c.u.hooks.duringGet=undefined;assert.equal(c.u.count(path),before+2);
 // Offline: state and last check stay; next check is later; nothing reconnects on its own.
 const kept=await accountRow(c.p.workspaceId);c.u.hooks.offline=true;
 assert.equal(await code(()=>syncLinkedinAccount(c.p,{accountId:id,requestId:randomUUID()},c.u.deps)),'503 LINKEDIN_SYNC_FAILED');
 c.u.hooks.offline=false;const off=await accountRow(c.p.workspaceId);
 assert.equal(off.state,kept.state);assert.equal(off.last_sync_at.toISOString(),kept.last_sync_at.toISOString());assert.equal(off.sync_failures,1);
 assert.ok(off.next_sync_at>new Date(Date.now()+4*60e3));assert.ok(off.last_error);assert.equal(c.u.links.length,1,'no reconnect link was requested');
 // A 429 waits at least what the vendor asked.
 c.u.hooks.retryAfter='7200';
 assert.equal(await code(()=>syncLinkedinAccount(c.p,{accountId:id,requestId:randomUUID()},c.u.deps)),'503 LINKEDIN_SYNC_FAILED');
 c.u.hooks.retryAfter=undefined;assert.ok((await accountRow(c.p.workspaceId)).next_sync_at>new Date(Date.now()+7100e3));
 // Revoked while the vendor answers: the answer is dropped.
 c.u.accounts.get(c.externalId)!.statuses=['OK'];
 c.u.hooks.duringGet=async()=>{c.u.hooks.duringGet=undefined;const r=await accountRow(c.p.workspaceId);await revokeLinkedinAccount(c.p,id,{expectedRevision:Number(r.revision)},c.u.deps);};
 assert.equal(await code(()=>syncLinkedinAccount(c.p,{accountId:id,requestId:randomUUID()},c.u.deps)),'409 LINKEDIN_REVOKED');
 assert.equal((await accountRow(c.p.workspaceId)).state,'revoked');
});

test('07A.1 a new attestation voids readiness until the next check; reconnect keeps the account and needs the same vendor account',async()=>{
 const c=await connected();
 await testAdmin(x=>x.query('DELETE FROM app.linkedin_capability_profile'));await enable();
 assert.equal((await readLinkedinAccount(c.p)).account!.ready,false);
 await syncLinkedinAccount(c.p,{accountId:c.account.id,requestId:randomUUID()},c.u.deps);
 assert.equal((await readLinkedinAccount(c.p)).account!.ready,true);
 c.u.accounts.get(c.externalId)!.statuses=['CREDENTIALS'];await syncLinkedinAccount(c.p,{accountId:c.account.id,requestId:randomUUID()},c.u.deps);
 const restricted=await accountRow(c.p.workspaceId);
 await confirmLinkedinConnection(c.p,c.p.sessionId,accept({accountId:c.account.id,expectedRevision:Number(restricted.revision)}),c.u.deps);
 const link=c.u.links.at(-1)!;assert.equal(link.type,'reconnect');assert.equal(link.reconnect_account,c.externalId);
 c.u.accounts.set('acc_wrong00000001',{name:'Outra',memberId:'ACoW',statuses:['OK']});
 assert.equal(await code(()=>receiveLinkedinNotify(notifyToken(link),{status:'RECONNECTED',account_id:'acc_wrong00000001',name:link.name},c.u.deps)),'409 LINKEDIN_ACCOUNT_MISMATCH');
 const original=c.u.accounts.get(c.externalId)!;c.u.accounts.set(c.externalId,{...original,memberId:'ACoSomeoneElse',statuses:['OK']});
 await confirmLinkedinConnection(c.p,c.p.sessionId,accept({accountId:c.account.id,expectedRevision:Number(restricted.revision)}),c.u.deps);
 assert.equal(await code(()=>completeLogin(c.u,c.u.links.at(-1)!,{id:c.externalId,status:'RECONNECTED'})),'409 LINKEDIN_ACCOUNT_MISMATCH','another LinkedIn member in the same vendor account');
 assert.equal(c.u.count('DELETE /api/v1/accounts/'+c.externalId),0,'a reconnect never removes the live account');
 c.u.accounts.set(c.externalId,{...original,statuses:['OK']});
 await confirmLinkedinConnection(c.p,c.p.sessionId,accept({accountId:c.account.id,expectedRevision:Number(restricted.revision)}),c.u.deps);
 await completeLogin(c.u,c.u.links.at(-1)!,{id:c.externalId,status:'RECONNECTED'});
 const after=await accountRow(c.p.workspaceId);
 assert.equal(after.id,c.account.id);assert.equal(after.state,'ready');assert.ok(Number(after.credential_epoch)>Number(restricted.credential_epoch));
 assert.equal(await code(()=>confirmLinkedinConnection(c.p,c.p.sessionId,accept(),c.u.deps)),'409 LINKEDIN_ACCOUNT_EXISTS','one live account per workspace');
});

test('07A.1 revoke: immediate, keeps history, removes the vendor session; a failed removal is retried by the worker',async()=>{
 const c=await connected(),row=await accountRow(c.p.workspaceId);
 const op=await user();
 assert.equal(await code(()=>revokeLinkedinAccount(c.p,c.account.id,{expectedRevision:Number(row.revision)+5},c.u.deps)),'409 REVISION_CONFLICT');
 c.u.hooks.deleteFails=true;
 await revokeLinkedinAccount(c.p,c.account.id,{expectedRevision:Number(row.revision)},c.u.deps);
 assert.equal((await readLinkedinAccount(c.p)).account,null);
 const revoked=await accountRow(c.p.workspaceId);assert.equal(revoked.state,'revoked');assert.equal(revoked.remote_delete_pending,true);
 assert.equal(await code(()=>syncLinkedinAccount(c.p,{accountId:c.account.id,requestId:randomUUID()},c.u.deps)),'404 LINKEDIN_NOT_FOUND');
 c.u.hooks.deleteFails=false;
 await testAdmin(x=>x.query('UPDATE app.linkedin_account SET next_sync_at=clock_timestamp() WHERE workspace_id=$1',[c.p.workspaceId]));
 await runLinkedinTick({limit:10},c.u.deps);
 assert.equal((await accountRow(c.p.workspaceId)).remote_delete_pending,false);assert.equal(c.u.accounts.has(c.externalId),false);
 assert.deepEqual(await events(c.p.workspaceId),['connected','revoked']);
 assert.equal(await code(()=>revokeLinkedinAccount(op.p,c.account.id,{expectedRevision:1},c.u.deps)),'404 LINKEDIN_NOT_FOUND','another workspace cannot reach this account');
 // The same LinkedIn account can be connected again as a new account.
 await confirmLinkedinConnection(c.p,c.p.sessionId,accept(),c.u.deps);
 c.u.accounts.set(c.externalId,{name:'[RE] Pessoa LinkedIn',memberId:'ACoAgain',statuses:['OK']});
 await completeLogin(c.u,c.u.links.at(-1)!,{id:c.externalId});
 assert.notEqual((await readLinkedinAccount(c.p)).account!.id,c.account.id);
});

test('07A.1 worker checks only due, live accounts and never crosses workspaces',async()=>{
 const a=await connected(),b=await connected(false),path=(x:string)=>'GET /api/v1/accounts/'+x;
 const ba=a.u.count(path(a.externalId)),bb=b.u.count(path(b.externalId));
 await testAdmin(x=>x.query('UPDATE app.linkedin_account SET next_sync_at=clock_timestamp() WHERE workspace_id=$1',[a.p.workspaceId]));
 a.u.accounts.get(a.externalId)!.statuses=['STOPPED'];
 await runLinkedinTick({limit:10},a.u.deps);
 assert.equal(a.u.count(path(a.externalId)),ba+1);assert.equal(b.u.count(path(b.externalId)),bb,'not due: not checked');
 assert.equal((await accountRow(a.p.workspaceId)).state,'error');assert.equal((await accountRow(b.p.workspaceId)).state,'ready');
 assert.ok((await accountRow(a.p.workspaceId)).next_sync_at>new Date(Date.now()+3600e3));
 // The worker role reads the gate: a re-attestation voids readiness and a worker check restores it.
 a.u.accounts.get(a.externalId)!.statuses=['OK'];
 await testAdmin(x=>x.query('DELETE FROM app.linkedin_capability_profile'));await enable();
 assert.equal((await readLinkedinAccount(a.p)).account!.ready,false);
 await testAdmin(x=>x.query('UPDATE app.linkedin_account SET next_sync_at=clock_timestamp() WHERE workspace_id=$1',[a.p.workspaceId]));
 await runLinkedinTick({limit:10},a.u.deps);
 assert.equal((await readLinkedinAccount(a.p)).account!.ready,true);
 // Gate off: no vendor call for health checks.
 await testAdmin(x=>x.query('UPDATE app.linkedin_capability_profile SET revoked_at=clock_timestamp()'));
 await testAdmin(x=>x.query('UPDATE app.linkedin_account SET next_sync_at=clock_timestamp() WHERE workspace_id=$1',[a.p.workspaceId]));
 const n=a.u.count(path(a.externalId));await runLinkedinTick({limit:10},a.u.deps);
 assert.equal(a.u.count(path(a.externalId)),n);
});

test('07A.1 HTTP and SQL boundaries: auth, roles, input, workspace, no-store; app role cannot bind or read vendor ids',async()=>{
 await enable();const owner=await user(),op=await user();
 const post=(h:Headers|null,body:unknown,path='/api/linkedin/accounts')=>new Request(base+path,{method:'POST',headers:{...(h?Object.fromEntries(h):{}),origin:base,'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await linkedinAccountsRequest(post(null,{action:'prepare-connect'}))).status,401);
 const got=await linkedinAccountsRequest(new Request(base+'/api/linkedin/accounts',{headers:owner.headers}));
 assert.equal(got.status,200);assert.equal(got.headers.get('cache-control'),'no-store');
 assert.equal((await linkedinAccountsRequest(post(owner.headers,{action:'nope'}))).status,422);
 assert.equal((await linkedinAccountsRequest(post(owner.headers,{action:'confirm-connect',input:{acceptTerms:'yes'}}))).status,422);
 const wrong=new Headers(owner.headers);wrong.set('x-cadence-workspace',op.p.workspaceId);
 assert.equal((await linkedinAccountsRequest(post(wrong,{action:'prepare-connect'}))).status,409);
 await setRole(op.p,'operator');
 assert.equal((await linkedinAccountsRequest(post(op.headers,{action:'confirm-connect',input:accept()}))).status,403);
 assert.equal((await linkedinAccountActionRequest(post(owner.headers,{},'/api/linkedin/accounts/x/explode'),randomUUID(),'explode')).status,404);
 const n=await linkedinNotifyRequest(new Request(base+'/api/linkedin/oauth/notify?token='+'y'.repeat(43),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status:'CREATION_SUCCESS',account_id:'acc_000000000001',name:'n'})}));
 assert.equal(n.status,404);assert.equal(await n.text().then(t=>t.includes('token')),false);
 assert.equal((await linkedinNotifyRequest(new Request(base+'/api/linkedin/oauth/notify?token=z',{method:'POST',body:'x'.repeat(20000)}))).status,422);
 const back=await linkedinCallbackRequest(new Request(base+'/api/linkedin/oauth/callback?state='+'s'.repeat(43)+'&result=success'));
 assert.equal(back.status,303);assert.equal(new URL(back.headers.get('location')!).searchParams.get('linkedin'),'failed');assert.equal(back.headers.get('cache-control'),'no-store');
 assert.equal((await linkedinNotifyRequest(new Request(base+'/api/linkedin/oauth/notify?token=z',{method:'POST',headers:{'content-length':'999999'},body:'{}'}))).status,422);
 const denied:string[]=[];
 for(const sql of ["SELECT app.bind_linkedin_account('a','b','c','d','ready','v')","SELECT external_account_id FROM app.linkedin_account","SELECT * FROM app.linkedin_connect_attempt"])
  denied.push(await withWorkspaceTransaction(owner.p,c=>c.query(sql)).then(()=>'ok',(e:{code?:string})=>e.code!));
 assert.deepEqual(denied,['42501','42501','42501']);
});
