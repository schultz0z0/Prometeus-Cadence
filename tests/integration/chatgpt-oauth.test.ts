import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {startOAuth,finishOAuth,selectOAuthModel,disconnectOAuth,oauthView} from '../../src/server/ai-oauth/service.ts';
import {oauthAccessToken,localOAuthRedirect} from '../../src/server/ai-oauth/session.ts';
import {createOAuthStore} from '../../src/server/ai-oauth/store.ts';
import {saveAiPolicy} from '../../src/server/prospecting/ai/settings.ts';
import {chatgptOAuthHttp,chatgptCallbackHttp} from '../../src/server/ai-oauth/http.ts';
import {prospectingUser,configureProspectingTest,closeProspectingPools,testAdmin} from './prospecting-helpers.ts';
configureProspectingTest();after(closeProspectingPools);
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'chatgpt-flow-')),store=createOAuthStore(root),{privateKey,publicKey}=await generateKeyPair('RS256'),key=await exportJWK(publicKey);key.kid='qa';
 const p=(await prospectingUser()).p;let nonce='',refreshes=0,revokes=0;
 const fetcher:typeof fetch=async(url,init)=>{
  if(String(url).endsWith('/models'))return Response.json({models:[{slug:'fixture-model',display_name:'Fixture Model',visibility:'list'},{slug:'hidden',display_name:'Hidden',visibility:'hide'}]});
  if(String(url).endsWith('/revoke')){revokes++;return new Response(null,{status:200});}
  assert.ok(String(url).endsWith('/oauth/token'));const form=new URLSearchParams(String(init?.body));
  assert.equal(form.get('resource'),'https://api.openai.com/v1');
  if(form.get('grant_type')==='refresh_token'){refreshes++;await new Promise(r=>setTimeout(r,20));return Response.json({access_token:'qa-rotated',refresh_token:'qa-refresh-rotated',expires_in:3600,token_type:'Bearer'});}
  assert.equal(form.get('redirect_uri'),localOAuthRedirect());assert.ok(form.get('code_verifier'));
  const id_token=await new SignJWT({nonce,email:'qa@example.com'}).setProtectedHeader({alg:'RS256',kid:'qa'}).setSubject('qa-subject').setIssuer('https://auth.openai.com').setAudience('qa-issued-client').setExpirationTime('5m').sign(privateKey);
  return Response.json({access_token:'qa-access',refresh_token:'qa-refresh',id_token,expires_in:3600,token_type:'Bearer',scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'});
 };
 const deps={store,fetcher,keys:{keys:[key]}};
 async function begin(){const u=new URL((await startOAuth(p,store.read(p.workspaceId)?.revision??0,deps)).url);nonce=u.searchParams.get('nonce')!;const callback=new URL(localOAuthRedirect()!);callback.searchParams.set('state',u.searchParams.get('state')!);callback.searchParams.set('code','qa-code');callback.searchParams.set('client_id','qa-issued-client');return callback;}
 return{root,store,p,deps,begin,counts:()=>({refreshes,revokes})};
}
test('direct OAuth registers per workspace, validates callback identity, rotates once, selects models and disconnects',async()=>{
 const f=await fixture();try{
  const callback=await f.begin(),view=await finishOAuth(f.p,callback,f.deps);
  assert.equal(view.state,'connected');assert.equal(view.model,'fixture-model');assert.equal(view.models.length,1);assert.equal(view.email,'qa@example.com');
  assert.ok(!JSON.stringify(view).includes('qa-access'));await assert.rejects(()=>finishOAuth(f.p,callback,f.deps));
  await saveAiPolicy(f.p,{requestId:randomUUID(),expectedRevision:0,policy:{mode:'conventional-only',conventionalProvider:'chatgpt-oauth',jevEnabled:false}});
  const row=f.store.read(f.p.workspaceId)!;f.store.save(f.p.workspaceId,{...row,expiresAt:Date.now()-1},f.store.credentials(f.p.workspaceId,row.revision));
  const tokens=await Promise.all([oauthAccessToken(f.p.workspaceId,row.revision,f.deps),oauthAccessToken(f.p.workspaceId,row.revision,f.deps)]);
  assert.deepEqual(tokens,['qa-rotated','qa-rotated']);assert.equal(f.counts().refreshes,1);assert.equal(f.store.read(f.p.workspaceId)?.revision,row.revision);
  await assert.rejects(()=>selectOAuthModel(f.p,row.revision,'hidden',f.deps),{status:422});
  const selected=await selectOAuthModel(f.p,row.revision,'fixture-model',f.deps);assert.equal(selected.revision,row.revision+1);
  await assert.rejects(()=>oauthAccessToken(f.p.workspaceId,row.revision,f.deps),{status:409});
  const off=await disconnectOAuth(f.p,selected.revision,f.deps);assert.equal(off.state,'disconnected');assert.equal(f.counts().revokes,1);assert.deepEqual(f.store.credentials(f.p.workspaceId,off.revision),{});
  assert.equal(f.store.read(f.p.workspaceId)?.hostId,row.hostId);assert.equal(f.store.read('other-workspace'),null);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('callback binds session and workspace; permission downgrade and hosted mode cannot connect',async()=>{
 const f=await fixture();try{
  const callback=await f.begin();await assert.rejects(()=>finishOAuth({...f.p,sessionId:'different'},callback,f.deps),{status:403});
  assert.equal(f.store.read(f.p.workspaceId)?.state,'disconnected');
  const next=await f.begin();await testAdmin(c=>c.query('UPDATE auth.member SET role=\'operator\' WHERE "organizationId"=$1 AND "userId"=$2',[f.p.workspaceId,f.p.userId]));
  await assert.rejects(()=>finishOAuth(f.p,next,f.deps),{status:403});
  process.env.CADENCE_RUNTIME_MODE='hosted';try{assert.equal(oauthView(f.p.workspaceId,f.store).available,false);await assert.rejects(()=>startOAuth(f.p,0,f.deps),{code:'CHATGPT_LOCAL_ONLY'});}finally{process.env.CADENCE_RUNTIME_MODE='local';}
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('database lock survives crashed owner and serializes competing child processes without stale files',async()=>{
 const workspace='qa-lock-'+randomUUID(),children:ReturnType<typeof fork>[]=[],events:string[]=[];
 const start=(name:string)=>{const child=fork(fileURLToPath(new URL('../fixtures/oauth-lock-child.ts',import.meta.url)),[workspace],{execArgv:['--experimental-strip-types'],stdio:['ignore','ignore','ignore','ipc']});children.push(child);child.on('message',message=>events.push(name+':'+message));return child;};
 async function until(predicate:()=>boolean){const end=Date.now()+10000;while(!predicate()){if(Date.now()>end)throw Error('Child lock timed out');await delay(20);}}
 try{
  const crashed=start('crashed');await until(()=>events.includes('crashed:acquired'));const dead=new Promise<void>(resolve=>crashed.once('exit',()=>resolve()));crashed.kill('SIGKILL');await dead;
  const a=start('a'),b=start('b');await until(()=>events.includes('a:acquired')||events.includes('b:acquired'));await delay(100);
  const acquired=events.filter(e=>e==='a:acquired'||e==='b:acquired');assert.equal(acquired.length,1);
  (acquired[0]==='a:acquired'?a:b).send('release');await until(()=>events.includes('a:acquired')&&events.includes('b:acquired'));
  (acquired[0]==='a:acquired'?b:a).send('release');assert.equal(events.some(e=>e.endsWith(':failed')),false);
 }finally{for(const child of children)if(child.exitCode===null)child.kill('SIGKILL');}
});
test('interrupted token rotation requires reconnection instead of repeating the old refresh token',async()=>{
 const f=await fixture();try{
  await finishOAuth(f.p,await f.begin(),f.deps);const row=f.store.read(f.p.workspaceId)!;
  f.store.save(f.p.workspaceId,{...row,refreshPending:true},f.store.credentials(f.p.workspaceId,row.revision));
  await assert.rejects(()=>oauthAccessToken(f.p.workspaceId,row.revision,f.deps),{code:'CHATGPT_RECONNECT_REQUIRED'});
  assert.equal(f.counts().refreshes,0);assert.equal(f.store.read(f.p.workspaceId)?.state,'attention');
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('OAuth HTTP rejects foreign origins and workspaces, operators and invalid callback state without leaking secrets',async()=>{
 const {p,headers}=await prospectingUser(),base=process.env.BETTER_AUTH_URL!;
 const request=(changes:Record<string,string>)=>{const h=new Headers(headers);h.set('content-type','application/json');for(const[k,v]of Object.entries(changes))h.set(k,v);return new Request(base+'/api/prospecting/ai/oauth/start',{method:'POST',headers:h,body:JSON.stringify({expectedRevision:0})});};
 assert.equal((await chatgptOAuthHttp(request({origin:'https://foreign.example'}),'start')).status,403);
 assert.equal((await chatgptOAuthHttp(request({'x-cadence-workspace':'foreign'}),'start')).status,409);
 const status=await chatgptOAuthHttp(new Request(base+'/api/prospecting/ai/oauth/status',{headers}),'status');assert.equal(status.status,200);assert.equal((await status.json()).state,'disconnected');
 const callback=await chatgptCallbackHttp(new Request(localOAuthRedirect()!+'?code=qa-sensitive-code&state=bad',{headers}));
 assert.equal(callback.status,303);assert.ok(callback.headers.get('location')?.endsWith('/settings/ai?chatgpt=failed'));assert.ok(!callback.headers.get('location')?.includes('qa-sensitive-code'));
 await testAdmin(c=>c.query('UPDATE auth.member SET role=\'operator\' WHERE "organizationId"=$1 AND "userId"=$2',[p.workspaceId,p.userId]));assert.equal((await chatgptOAuthHttp(request({}),'start')).status,403);
});
test('missing plan consent and unavailable catalog retain registration but cannot enable inference',async()=>{
 for(const failure of ['consent','catalog']){const f=await fixture();try{
  const callback=await f.begin(),original=f.deps.fetcher;
  const fetcher:typeof fetch=async(url,init)=>{if(failure==='catalog'&&String(url).endsWith('/models'))return new Response(null,{status:503});const response=await original(url,init);if(failure==='consent'&&String(url).endsWith('/oauth/token')){const body=await response.json();return Response.json({...body,scope:'openid profile email offline_access'});}return response;};
  const view=await finishOAuth(f.p,callback,{...f.deps,fetcher});assert.equal(view.state,'attention');assert.equal(view.lastError,failure==='consent'?'CHATGPT_PLAN_PERMISSION_REQUIRED':'CHATGPT_CATALOG_UNAVAILABLE');assert.equal(f.store.read(f.p.workspaceId)?.clientId,'qa-issued-client');
  await assert.rejects(()=>oauthAccessToken(f.p.workspaceId,view.revision,f.deps),{code:'AI_CONFIGURATION_CHANGED'});
 }finally{await rm(f.root,{recursive:true,force:true});}}
});
