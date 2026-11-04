import test,{after,beforeEach} from 'node:test';import assert from 'node:assert/strict';import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {base,resetRateLimits} from './helpers.ts';
import {prospectingUser,testAdmin,closeProspectingPools} from './prospecting-helpers.ts';
import {readMcpAuthorizationRequest,decideMcpAuthorization,listMcpConnections,revokeMcpConnection} from '../../src/server/mcp/authorization.ts';
import {mcpRequest,mcpOauthRequest,mcpMetadataRequest,mcpConsentRequest} from '../../src/server/mcp/http.ts';
after(closeProspectingPools);
beforeEach(resetRateLimits);
const RES=base+'/api/mcp',CB='https://client.example.com/oauth/callback';
type U=Awaited<ReturnType<typeof prospectingUser>>;
const code=async(fn:()=>Promise<unknown>)=>{try{await fn();return 'ok';}catch(e){const x=e as {status?:number;code?:string};return `${x.status}${x.code?' '+x.code:''}`;}};
async function register(redirect_uris=[CB]){const r=await mcpOauthRequest(new Request(base+'/api/mcp/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'[RE] Cliente QA',redirect_uris})}),'register');return{status:r.status,body:await r.json()};}
function pkce(){const verifier=randomBytes(32).toString('base64url');return{verifier,challenge:createHash('sha256').update(verifier).digest('base64url')};}
async function startAuth(clientId:string,o:Record<string,string>={}){
 const q=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:CB,code_challenge:o.challenge??'',code_challenge_method:'S256',state:'st-1',resource:RES,scope:'contacts.read jobs.read metrics.read',...o});q.delete('challenge');
 return mcpOauthRequest(new Request(base+'/api/mcp/oauth/authorize?'+q),'authorize');
}
const form=(o:Record<string,string>)=>new Request(base+'/api/mcp/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(o)});
const token=async(o:Record<string,string>)=>{const r=await mcpOauthRequest(form(o),'token');return{status:r.status,body:await r.json()};};
/** Register, authorize as u, exchange the code. */
async function connect(u:U,scope='contacts.read jobs.read metrics.read'){
 const c=(await register()).body,k=pkce();
 const a=await startAuth(c.client_id,{challenge:k.challenge,scope});assert.equal(a.status,302);
 const requestId=new URL(a.headers.get('location')!,base).searchParams.get('request')!;
 const d=await decideMcpAuthorization(u.p,{requestId,workspaceId:u.p.workspaceId,decision:'allow'});
 const cb=new URL(d.redirectTo);assert.equal(cb.origin+cb.pathname,CB);assert.equal(cb.searchParams.get('state'),'st-1');
 const t=await token({grant_type:'authorization_code',code:cb.searchParams.get('code')!,redirect_uri:CB,client_id:c.client_id,code_verifier:k.verifier,resource:RES});
 assert.equal(t.status,200,JSON.stringify(t.body));return{client:c,code:cb.searchParams.get('code')!,verifier:k.verifier,...t.body as {access_token:string;refresh_token:string;expires_in:number;scope:string}};
}
let rid=0;
async function rpc(access:string|null,method:string,params?:Record<string,unknown>,headers:Record<string,string>={}){
 const r=await mcpRequest(new Request(RES,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25',...(access?{authorization:'Bearer '+access}:{}),...headers},body:JSON.stringify({jsonrpc:'2.0',...(method.startsWith('notifications/')?{}:{id:++rid}),method,...(params?{params}:{})})}));
 return{status:r.status,headers:r.headers,body:r.status===202||r.headers.get('content-type')?.includes('json')!==true?null:await r.json()};
}
async function lead(u:U,name:string){const list=randomUUID();await testAdmin(async c=>{await c.query('INSERT INTO app.list(workspace_id,id,name) VALUES($1,$2,$3)',[u.p.workspaceId,list,'[RE] Lista MCP']);
 await c.query('INSERT INTO app.lead(workspace_id,id,list_id,payload) VALUES($1,$2,$3,$4)',[u.p.workspaceId,randomUUID(),list,{name,qualification:'pending',createdAt:new Date().toISOString()}]);});}

test('07C.3a metadata: protected resource and authorization server',async()=>{
 const pr=await (await mcpMetadataRequest(new Request(base+'/.well-known/oauth-protected-resource/api/mcp'),'resource')).json();
 assert.equal(pr.resource,RES);assert.deepEqual(pr.authorization_servers,[base]);assert.deepEqual(pr.bearer_methods_supported,['header']);
 const as=await (await mcpMetadataRequest(new Request(base+'/.well-known/oauth-authorization-server'),'server')).json();
 assert.equal(as.issuer,base);assert.deepEqual(as.code_challenge_methods_supported,['S256']);assert.deepEqual(as.token_endpoint_auth_methods_supported,['none']);
 assert.ok(as.registration_endpoint&&as.token_endpoint&&as.authorization_endpoint&&as.revocation_endpoint);
 const bad=await register(['http://evil.example/cb']);assert.equal(bad.status,400);assert.equal(bad.body.error,'invalid_redirect_uri');
});

test('07C.3a full flow: consent, token, initialize, tools; only the authorized workspace',async()=>{
 const u=await prospectingUser({billing:false}),v=await prospectingUser({billing:false});await lead(u,'[RE] Lead MCP Visível');await lead(v,'[RE] Lead de outro workspace');
 const t=await connect(u);assert.equal(t.expires_in,900);assert.equal(t.scope,'contacts.read jobs.read metrics.read');
 const init=await rpc(t.access_token,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'qa',version:'1'}});
 assert.equal(init.body.result.protocolVersion,'2025-06-18');assert.ok(init.body.result.capabilities.tools);
 assert.equal((await rpc(t.access_token,'notifications/initialized')).status,202);
 const tools=(await rpc(t.access_token,'tools/list')).body.result.tools.map((x:{name:string})=>x.name).sort();
 assert.deepEqual(tools,['contacts_search','jobs_list','metrics_read']);
 const found=await rpc(t.access_token,'tools/call',{name:'contacts_search',arguments:{query:'Lead'}});
 const text=found.body.result.content[0].text;assert.ok(text.includes('[RE] Lead MCP Visível'));assert.ok(!text.includes('outro workspace'));
 assert.equal((await rpc(t.access_token,'tools/call',{name:'metrics_read',arguments:{days:7}})).body.result.isError,undefined);
 assert.equal((await rpc(t.access_token,'tools/call',{name:'jobs_list',arguments:{}})).body.result.isError,undefined);
 const only=await connect(u,'metrics.read');
 assert.deepEqual((await rpc(only.access_token,'tools/list')).body.result.tools.map((x:{name:string})=>x.name),['metrics_read']);
 const denied=await rpc(only.access_token,'tools/call',{name:'contacts_search',arguments:{}});
 assert.equal(denied.status,403);assert.match(denied.headers.get('www-authenticate')!,/insufficient_scope/);
 const conns=await listMcpConnections(u.p);assert.equal(conns.length,2);assert.equal(conns[0].clientName,'[RE] Cliente QA');
 assert.equal((await listMcpConnections(v.p)).length,0);
});

test('07C.3a reuse: a reused code or refresh revokes the grant; mismatches are refused',async()=>{
 const u=await prospectingUser({billing:false}),t=await connect(u);
 const again=await token({grant_type:'authorization_code',code:t.code,redirect_uri:CB,client_id:t.client.client_id,code_verifier:t.verifier,resource:RES});
 assert.equal(again.status,400);assert.equal(again.body.error,'invalid_grant');
 assert.equal((await rpc(t.access_token,'tools/list')).status,401,'the reused code revoked the grant');
 const s=await connect(u),r1=await token({grant_type:'refresh_token',refresh_token:s.refresh_token,client_id:s.client.client_id,resource:RES});
 assert.equal(r1.status,200);assert.notEqual(r1.body.refresh_token,s.refresh_token);
 assert.equal((await rpc(r1.body.access_token,'tools/list')).status,200);
 const reused=await token({grant_type:'refresh_token',refresh_token:s.refresh_token,client_id:s.client.client_id,resource:RES});assert.equal(reused.body.error,'invalid_grant');
 assert.equal((await rpc(r1.body.access_token,'tools/list')).status,401,'refresh reuse revokes the whole grant');
 assert.equal((await token({grant_type:'refresh_token',refresh_token:r1.body.refresh_token,client_id:s.client.client_id})).body.error,'invalid_grant');
 // Wrong verifier, other redirect, other client, expired code.
 const c=(await register()).body,k=pkce(),a=await startAuth(c.client_id,{challenge:k.challenge});
 const rq=new URL(a.headers.get('location')!,base).searchParams.get('request')!,d=new URL((await decideMcpAuthorization(u.p,{requestId:rq,workspaceId:u.p.workspaceId,decision:'allow'})).redirectTo);
 const cd=d.searchParams.get('code')!;
 assert.equal((await token({grant_type:'authorization_code',code:cd,redirect_uri:CB,client_id:c.client_id,code_verifier:pkce().verifier,resource:RES})).body.error,'invalid_grant');
 const c2=(await register()).body,k2=pkce(),a2=await startAuth(c2.client_id,{challenge:k2.challenge});
 const rq2=new URL(a2.headers.get('location')!,base).searchParams.get('request')!,cd2=new URL((await decideMcpAuthorization(u.p,{requestId:rq2,workspaceId:u.p.workspaceId,decision:'allow'})).redirectTo).searchParams.get('code')!;
 await testAdmin(q=>q.query("UPDATE app.mcp_auth_code SET expires_at=clock_timestamp()-interval '1 second'"));
 assert.equal((await token({grant_type:'authorization_code',code:cd2,redirect_uri:CB,client_id:c2.client_id,code_verifier:k2.verifier,resource:RES})).body.error,'invalid_grant');
 // Unknown redirect never redirects; a missing PKCE redirects with an error.
 assert.equal((await startAuth(c.client_id,{challenge:k.challenge,redirect_uri:'https://other.example/cb'})).status,400);
 const noPkce=await startAuth(c.client_id,{challenge:'',code_challenge_method:'plain'});assert.equal(noPkce.status,302);assert.equal(new URL(noPkce.headers.get('location')!).searchParams.get('error'),'invalid_request');
});

test('07C.3a audience, removal and revocation stop the token',async()=>{
 const owner=await prospectingUser({billing:false}),mate=await prospectingUser({billing:false}),mp={...mate.p,workspaceId:owner.p.workspaceId};
 await testAdmin(c=>c.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',[randomUUID(),owner.p.workspaceId,mate.p.userId,'operator']));
 const t=await connect({...mate,p:mp});
 const c=(await register()).body,k=pkce(),a=await startAuth(c.client_id,{challenge:k.challenge,resource:'https://other.example/mcp'});
 assert.equal(new URL(a.headers.get('location')!).searchParams.get('error'),'invalid_target');
 assert.equal((await rpc(t.access_token,'tools/list')).status,200);
 await testAdmin(q=>q.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[owner.p.workspaceId,mate.p.userId]));
 const gone=await rpc(t.access_token,'tools/call',{name:'contacts_search',arguments:{}});assert.equal(gone.status,403);
 const o=await connect(owner),[conn]=(await listMcpConnections(owner.p)).filter(x=>x.mine);
 assert.equal(await code(()=>revokeMcpConnection(mp,conn.id)),'403');
 await revokeMcpConnection(owner.p,conn.id);
 assert.equal((await rpc(o.access_token,'tools/list')).status,401);
 assert.equal((await token({grant_type:'refresh_token',refresh_token:o.refresh_token,client_id:o.client.client_id})).body.error,'invalid_grant');
 const r=await mcpOauthRequest(new Request(base+'/api/mcp/oauth/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:'nope'})}),'revoke');assert.equal(r.status,200);
});

test('07C.3a consent: workspace must be the session one; deny returns access_denied',async()=>{
 const u=await prospectingUser({billing:false}),v=await prospectingUser({billing:false}),c=(await register()).body,k=pkce();
 const rq=new URL((await startAuth(c.client_id,{challenge:k.challenge})).headers.get('location')!,base).searchParams.get('request')!;
 const view=await readMcpAuthorizationRequest(u.p,rq);assert.equal(view.client.name,'[RE] Cliente QA');assert.deepEqual(view.scopes.map(s=>s.id),['contacts.read','jobs.read','metrics.read']);
 assert.equal(await code(()=>decideMcpAuthorization(u.p,{requestId:rq,workspaceId:v.p.workspaceId,decision:'allow'})),'409 WORKSPACE_CHANGED');
 const http=await mcpConsentRequest(new Request(base+'/api/mcp/oauth/consent',{method:'POST',headers:{...Object.fromEntries(u.headers),'content-type':'application/json'},body:JSON.stringify({requestId:rq,workspaceId:u.p.workspaceId,decision:'deny'})}));
 assert.equal(http.status,200);const to=new URL((await http.json()).redirectTo);assert.equal(to.searchParams.get('error'),'access_denied');assert.equal(to.searchParams.get('state'),'st-1');
 assert.equal(await code(()=>decideMcpAuthorization(u.p,{requestId:rq,workspaceId:u.p.workspaceId,decision:'allow'})),'409 MCP_REQUEST_USED');
 const anon=await mcpConsentRequest(new Request(base+'/api/mcp/oauth/consent',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:'{}'}));assert.equal(anon.status,401);
});

test('07C.3a HTTP: 401 with metadata, 405, Origin, versions, batch',async()=>{
 const u=await prospectingUser({billing:false}),t=await connect(u);
 const none=await rpc(null,'tools/list');assert.equal(none.status,401);assert.match(none.headers.get('www-authenticate')!,/resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
 assert.equal((await rpc('nope','tools/list')).status,401);
 assert.equal((await mcpRequest(new Request(RES,{method:'GET',headers:{authorization:'Bearer '+t.access_token}}))).status,405);
 assert.equal((await rpc(t.access_token,'tools/list',undefined,{origin:'https://evil.example'})).status,403);
 assert.equal((await rpc(t.access_token,'tools/list',undefined,{'mcp-protocol-version':'1999-01-01'})).status,400);
 const batch=await mcpRequest(new Request(RES,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+t.access_token},body:JSON.stringify([{jsonrpc:'2.0',id:1,method:'ping'}])}));
 assert.equal((await batch.json()).error.code,-32600);
 const unknown=await rpc(t.access_token,'tools/call',{name:'admin_dump',arguments:{}});assert.equal(unknown.body.error.code,-32602);
 const ping=await rpc(t.access_token,'ping');assert.deepEqual(ping.body.result,{});
 const leak=JSON.stringify(await listMcpConnections(u.p));assert.ok(!leak.includes(t.access_token)&&!leak.includes(t.refresh_token));
});

// Review findings (106a).
const regFrom=async(ip:string)=>(await mcpOauthRequest(new Request(base+'/api/mcp/oauth/register',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':ip+', 10.0.0.1'},body:JSON.stringify({client_name:'[RE] Cliente QA',redirect_uris:[CB]})}),'register')).status;
test('07C.3a review: registration is limited per address and unused clients are swept',async()=>{
 for(let i=0;i<20;i++)assert.equal(await regFrom('203.0.113.7'),201);
 assert.equal(await regFrom('203.0.113.7'),429);
 assert.equal(await regFrom('203.0.113.8'),201,'another address is not blocked');
 const stale=(await register()).body.client_id;
 await testAdmin(q=>q.query("UPDATE app.mcp_client SET created_at=clock_timestamp()-interval '2 days' WHERE id=$1",[stale]));
 await regFrom('203.0.113.9');
 assert.equal((await testAdmin(q=>q.query('SELECT 1 FROM app.mcp_client WHERE id=$1',[stale]))).rowCount,0,'a client never authorized is removed after a day');
});
test('07C.3a review: open authorization requests per client are capped; expired ones are purged',async()=>{
 const c=(await register()).body,k=pkce();
 for(let i=0;i<20;i++)assert.equal((await startAuth(c.client_id,{challenge:k.challenge})).headers.get('location')!.startsWith(base+'/mcp/authorize'),true);
 const full=new URL((await startAuth(c.client_id,{challenge:k.challenge})).headers.get('location')!);
 assert.equal(full.searchParams.get('error'),'temporarily_unavailable');assert.equal(full.searchParams.get('iss'),base,'error redirects carry iss');
 await testAdmin(q=>q.query("UPDATE app.mcp_auth_request SET expires_at=clock_timestamp()-interval '1 second' WHERE client_id=$1",[c.client_id]));
 assert.ok((await startAuth(c.client_id,{challenge:k.challenge})).headers.get('location')!.startsWith(base+'/mcp/authorize'));
 assert.equal((await testAdmin(q=>q.query('SELECT 1 FROM app.mcp_auth_request WHERE client_id=$1',[c.client_id]))).rowCount,1);
});
test('07C.3a review: only live connections are listed; removal revokes; expired tokens are purged',async()=>{
 const u=await prospectingUser({billing:false}),c=(await register()).body,k=pkce();
 const rq=new URL((await startAuth(c.client_id,{challenge:k.challenge})).headers.get('location')!,base).searchParams.get('request')!;
 await decideMcpAuthorization(u.p,{requestId:rq,workspaceId:u.p.workspaceId,decision:'allow'});
 assert.equal((await listMcpConnections(u.p)).length,0,'a consent whose code was never exchanged is not a connection');
 const t=await connect(u);assert.equal((await listMcpConnections(u.p)).length,1);
 await testAdmin(q=>q.query("UPDATE app.mcp_token SET expires_at=clock_timestamp()-interval '1 second' WHERE kind='access'"));
 const r=await token({grant_type:'refresh_token',refresh_token:t.refresh_token,client_id:t.client.client_id,resource:RES});assert.equal(r.status,200);
 assert.equal((await testAdmin(q=>q.query("SELECT 1 FROM app.mcp_token t JOIN app.mcp_grant g ON g.id=t.grant_id WHERE g.workspace_id=$1 AND t.expires_at<=clock_timestamp()",[u.p.workspaceId]))).rowCount,0);
 const owner=await prospectingUser({billing:false}),mate=await prospectingUser({billing:false}),mp={...mate.p,workspaceId:owner.p.workspaceId};
 const add=()=>testAdmin(q=>q.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',[randomUUID(),owner.p.workspaceId,mate.p.userId,'operator']));
 await add();const m=await connect({...mate,p:mp});
 await testAdmin(q=>q.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[owner.p.workspaceId,mate.p.userId]));
 assert.equal((await rpc(m.access_token,'tools/list')).status,403);
 await add();
 assert.equal((await rpc(m.access_token,'tools/list')).status,401,'invited back: the old connection does not come back');
});
