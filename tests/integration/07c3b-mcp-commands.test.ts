import test,{after,beforeEach} from 'node:test';import assert from 'node:assert/strict';import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {base,resetRateLimits} from './helpers.ts';
import {prospectingUser,testAdmin,closeProspectingPools} from './prospecting-helpers.ts';
import {verifiedMetaFixture} from './whatsapp-helpers.ts';
import {executeWorkspaceCommand,readWorkspaceSnapshot} from '../../src/server/workspaces/commands.ts';
import {decideMcpAuthorization,readMcpAuthorizationRequest} from '../../src/server/mcp/authorization.ts';
import {mcpRequest,mcpOauthRequest,mcpMetadataRequest} from '../../src/server/mcp/http.ts';
import {prepareAssistantAction,confirmAssistantAction,readAssistantProposal} from '../../src/server/assistant/commands.ts';
import {answerAssistant,type AssistantDeps} from '../../src/server/assistant/service.ts';
import type {Principal} from '../../src/domain/workspace.ts';
after(closeProspectingPools);
beforeEach(resetRateLimits);
const RES=base+'/api/mcp',CB='https://client.example.com/oauth/callback',ALL='contacts.read jobs.read metrics.read messages.read actions.prepare actions.confirm',EVERY=ALL.split(' ');
type U=Awaited<ReturnType<typeof prospectingUser>>;
function pkce(){const verifier=randomBytes(32).toString('base64url');return{verifier,challenge:createHash('sha256').update(verifier).digest('base64url')};}
const tokenReq=(o:Record<string,string>)=>new Request(base+'/api/mcp/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(o)});
async function authRequest(scope?:string){
 const c=await (await mcpOauthRequest(new Request(base+'/api/mcp/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'[RE] Cliente QA',redirect_uris:[CB]})}),'register')).json(),k=pkce();
 const q=new URLSearchParams({response_type:'code',client_id:c.client_id,redirect_uri:CB,code_challenge:k.challenge,code_challenge_method:'S256',state:'st',resource:RES,...(scope?{scope}:{})});
 const a=await mcpOauthRequest(new Request(base+'/api/mcp/oauth/authorize?'+q),'authorize');assert.equal(a.status,302);
 return{client:c.client_id as string,verifier:k.verifier,requestId:new URL(a.headers.get('location')!,base).searchParams.get('request')!};
}
/** Authorize as u with the scopes the person ticked (undefined = the request as it came). */
async function connect(u:U,chosen:string[]|null=EVERY,scope:string=ALL){
 const r=await authRequest(scope);
 const d=new URL((await decideMcpAuthorization(u.p,{requestId:r.requestId,workspaceId:u.p.workspaceId,decision:'allow',...(chosen?{scopes:chosen}:{})})).redirectTo);
 const t=await (await mcpOauthRequest(tokenReq({grant_type:'authorization_code',code:d.searchParams.get('code')!,redirect_uri:CB,client_id:r.client,code_verifier:r.verifier,resource:RES}),'token')).json();
 assert.ok(t.access_token,JSON.stringify(t));return t as {access_token:string;scope:string};
}
let rid=0;
async function rpc(access:string,method:string,params?:Record<string,unknown>){
 const r=await mcpRequest(new Request(RES,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25',authorization:'Bearer '+access},body:JSON.stringify({jsonrpc:'2.0',id:++rid,method,...(params?{params}:{})})}));
 return{status:r.status,body:r.headers.get('content-type')?.includes('json')?await r.json():null};
}
const call=async(access:string,name:string,args:Record<string,unknown>)=>{const r=await rpc(access,'tools/call',{name,arguments:args});assert.equal(r.status,200,JSON.stringify(r.body));
 const res=r.body.result as {isError?:boolean;content:{text:string}[]};return{error:res.isError===true,text:res.content[0].text,data:res.isError?null:JSON.parse(res.content[0].text)};};
const names=async(access:string)=>(await rpc(access,'tools/list')).body.result.tools.map((t:{name:string})=>t.name).sort();
const lead=(id:string)=>({id,listId:'base',name:'Contato '+id,qualification:'pending',source:'MANUAL',createdAt:new Date().toISOString()});
async function seed(p:Principal,ids:string[]){const s=await readWorkspaceSnapshot(p);await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'leads.import',dedupScope:'list',list:{id:'base',name:'Base MCP'},leads:ids.map(lead)}});}
const rows=(t:string,ws:string,where='')=>testAdmin(async c=>Number((await c.query(`SELECT count(*) FROM app.${t} WHERE workspace_id=$1 ${where}`,[ws])).rows[0].count));

test('07C.3b metadata and tools/list follow the granted scopes',async()=>{
 const pr=await (await mcpMetadataRequest(new Request(base+'/.well-known/oauth-protected-resource/api/mcp'),'resource')).json();
 assert.deepEqual(pr.scopes_supported,ALL.split(' '));
 const u=await prospectingUser();
 const full=await connect(u);assert.equal(full.scope,ALL);
 assert.equal((await connect(u,null)).scope,'contacts.read jobs.read metrics.read messages.read actions.prepare','review M2: no explicit choice leaves confirm out');
 assert.deepEqual(await names(full.access_token),['action_cancel','action_confirm','audience_prepare','cadence_prepare','contacts_search','conversations_list','jobs_list','lists_list','metrics_read','qualification_prepare','reply_prepare']);
 const read=await connect(u,['contacts.read']);assert.deepEqual(await names(read.access_token),['contacts_search','lists_list']);
 const msgs=await connect(u,['messages.read']);assert.deepEqual(await names(msgs.access_token),['conversations_list'],'review M3: reading conversations is its own scope');
 const prep=await connect(u,['actions.prepare']);assert.ok(!(await names(prep.access_token)).includes('action_confirm'));
 const tools=(await rpc(full.access_token,'tools/list')).body.result.tools as {name:string;annotations:Record<string,boolean>}[];
 assert.equal(tools.find(t=>t.name==='action_confirm')!.annotations.readOnlyHint,false);assert.equal(tools.find(t=>t.name==='lists_list')!.annotations.readOnlyHint,true);
});

test('07C.3b consent: the person picks scopes; confirm needs prepare; nothing picked is refused without consuming the request',async()=>{
 const u=await prospectingUser({billing:false});
 const r=await authRequest();
 const view=await readMcpAuthorizationRequest(u.p,r.requestId);
 assert.deepEqual(view.scopes.map(s=>[s.id,s.checked]),[['contacts.read',true],['jobs.read',true],['metrics.read',true],['messages.read',true],['actions.prepare',true],['actions.confirm',false]]);
 await assert.rejects(decideMcpAuthorization(u.p,{requestId:r.requestId,workspaceId:u.p.workspaceId,decision:'allow',scopes:[]}),{status:422});
 await assert.rejects(decideMcpAuthorization(u.p,{requestId:r.requestId,workspaceId:u.p.workspaceId,decision:'allow',scopes:['actions.confirm']}),{status:422});
 const d=new URL((await decideMcpAuthorization(u.p,{requestId:r.requestId,workspaceId:u.p.workspaceId,decision:'allow',scopes:['metrics.read','actions.confirm']})).redirectTo);
 const t=await (await mcpOauthRequest(tokenReq({grant_type:'authorization_code',code:d.searchParams.get('code')!,redirect_uri:CB,client_id:r.client,code_verifier:r.verifier,resource:RES}),'token')).json();
 assert.equal(t.scope,'metrics.read');
 assert.equal((await connect(u,['contacts.read','actions.prepare'],'contacts.read')).scope,'contacts.read','never more than the client asked');
 // Review L6: a request already answered says so, even with an empty choice.
 await assert.rejects(decideMcpAuthorization(u.p,{requestId:r.requestId,workspaceId:u.p.workspaceId,decision:'allow',scopes:[]}),{status:409,code:'MCP_REQUEST_USED'});
 // Review L3: the database itself drops confirm without prepare.
 const raw=await authRequest(ALL);
 await testAdmin(c=>c.query("UPDATE app.mcp_auth_request SET scopes=ARRAY['metrics.read','actions.confirm'] WHERE id=$1",[raw.requestId]));
 const d2=new URL((await decideMcpAuthorization(u.p,{requestId:raw.requestId,workspaceId:u.p.workspaceId,decision:'allow',scopes:['metrics.read','actions.prepare','actions.confirm']})).redirectTo);
 const t2=await (await mcpOauthRequest(tokenReq({grant_type:'authorization_code',code:d2.searchParams.get('code')!,redirect_uri:CB,client_id:raw.client,code_verifier:raw.verifier,resource:RES}),'token')).json();
 assert.equal(t2.scope,'metrics.read');
});

test('07C.3b qualification: prepare creates nothing; confirm twice creates one job and zero sends; changed base is 409',async()=>{
 const u=await prospectingUser(),other=await prospectingUser();await seed(u.p,['m1','m2']);
 await testAdmin(c=>c.query("INSERT INTO app.list(workspace_id,id,name) VALUES($1,'foreign','[RE] Lista alheia')",[other.p.workspaceId]));
 const t=await connect(u);
 const lists=await call(t.access_token,'lists_list',{});assert.deepEqual(lists.data.lists.map((l:{id:string;leads:number})=>[l.id,l.leads]),[['base',2]]);
 assert.deepEqual((await call(t.access_token,'lists_list',{query:'nada disso'})).data.lists,[],'review L7: lists can be searched by name');
 assert.equal((await call(t.access_token,'lists_list',{query:'mcp'})).data.lists.length,1);
 // Review M1: a prepare that fails leaves no open proposal behind.
 await testAdmin(c=>c.query("INSERT INTO app.list(workspace_id,id,name) VALUES($1,'empty','[RE] Vazia')",[u.p.workspaceId]));
 const empty=await call(t.access_token,'qualification_prepare',{listId:'empty'});assert.ok(empty.error);assert.match(empty.text,/contatos/);
 assert.equal(await rows('assistant_proposal',u.p.workspaceId,"AND state='proposed'"),0);
 const jobs=await rows('prospecting_job',u.p.workspaceId),outbox=await rows('message_outbox',u.p.workspaceId);
 const foreign=await call(t.access_token,'qualification_prepare',{listId:'foreign'});assert.ok(foreign.error);assert.match(foreign.text,/lista/i);
 assert.equal(await rows('assistant_proposal',u.p.workspaceId,"AND state='proposed'"),0);
 const first=await call(t.access_token,'qualification_prepare',{listId:'base'});assert.ok(!first.error,first.text);
 assert.match(first.data.summary,/Base MCP.*2 contatos/);assert.deepEqual(first.data.blockers,[]);assert.ok(first.data.confirmation);
 assert.equal(first.data.reviewUrl,base+'/mcp/review/'+first.data.proposalId);
 assert.equal(await rows('prospecting_job',u.p.workspaceId),jobs,'preparing executes nothing');
 assert.equal(await rows('assistant_proposal',u.p.workspaceId,"AND grant_id IS NOT NULL AND role_ref IS NULL AND state='proposed'"),1);
 await seed(u.p,['m3']);
 const stale=await call(t.access_token,'action_confirm',{proposalId:first.data.proposalId,confirmation:first.data.confirmation});
 assert.ok(stale.error);assert.match(stale.text,/mudou|revis/i);
 const again=await call(t.access_token,'qualification_prepare',{listId:'base'});
 const one=await call(t.access_token,'action_confirm',{proposalId:again.data.proposalId,confirmation:again.data.confirmation});assert.ok(!one.error,one.text);
 const two=await call(t.access_token,'action_confirm',{proposalId:again.data.proposalId,confirmation:again.data.confirmation});
 assert.equal(one.data.entityId,two.data.entityId);assert.equal(one.data.url,base+'/executions/'+one.data.entityId);
 assert.equal(await rows('prospecting_job',u.p.workspaceId),jobs+1);assert.equal(await rows('message_outbox',u.p.workspaceId),outbox);
});

test('07C.3b without actions.confirm there is no token; the person confirms in the app; other proposals are out of reach',async()=>{
 const u=await prospectingUser(),v=await prospectingUser();await seed(u.p,['r1']);
 const prep=await connect(u,['contacts.read','actions.prepare']),full=await connect(u);
 const pr=await call(prep.access_token,'qualification_prepare',{listId:'base'});assert.ok(!pr.error,pr.text);
 assert.equal(pr.data.confirmation,undefined);assert.match(pr.data.next,/review|revis/i);
 // Another connection of the same person cannot confirm or cancel it.
 const review=await prepareAssistantAction(u.p,pr.data.proposalId);
 assert.ok((await call(full.access_token,'action_confirm',{proposalId:pr.data.proposalId,confirmation:review.review.token})).error);
 assert.ok((await call(full.access_token,'action_cancel',{proposalId:pr.data.proposalId})).error);
 // The app page reads it for its owner only, then confirms through the same reviewed path.
 const seen=await readAssistantProposal(u.p,pr.data.proposalId);assert.equal(seen.proposal.kind,'qualify-list');assert.equal(seen.workspaceId,u.p.workspaceId);
 await assert.rejects(readAssistantProposal(v.p,pr.data.proposalId),{status:404});
 const done=await confirmAssistantAction(u.p,pr.data.proposalId,{token:review.review.token,requestId:randomUUID()});assert.equal(done.proposal.state,'confirmed');
 // A chat proposal is never confirmed through MCP.
 const route={provider:'openai' as const,model:'qa',configFingerprint:'qa',contractVersion:'conventional-v1' as const};
 const deps:AssistantDeps={route,generate:async(_c,r)=>({value:r.parse({text:'Ok.',citations:[],proposal:{kind:'qualify-list',description:null,channel:null,listId:'base',objective:null,channels:null,tone:null,conversationId:null,text:null}}),usage:{provider:'openai'}})};
 const chat=(await answerAssistant(u.p,{text:'qualifica a base',contextRoute:'/',requestId:randomUUID()},deps)).message.proposal!;
 const chatReview=await prepareAssistantAction(u.p,chat.id);
 assert.ok((await call(full.access_token,'action_confirm',{proposalId:chat.id,confirmation:chatReview.review.token})).error);
 assert.equal((await readAssistantProposal(u.p,chat.id)).proposal.state,'proposed');
});

test('07C.3b reply draft: conversations listed as untrusted, draft stored once, nothing sent; cancel works',async()=>{
 const f=await verifiedMetaFixture(),p=f.u.p,identity=randomUUID(),conversation=randomUUID();
 await testAdmin(async c=>{
  await c.query("INSERT INTO app.channel_identity(workspace_id,id,scope,external_id) VALUES($1,$2,'fixture',$2)",[p.workspaceId,identity]);
  await c.query("INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id,channel,last_message_at) VALUES($1,$2,$3,$4,$5,'WHATSAPP',now())",[p.workspaceId,conversation,f.connection.id,f.sender.id,identity]);
  await c.query("INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,state,text,occurred_at) VALUES($1,gen_random_uuid()::text,$2,$3,$4,$5,'inbound','received','Quanto custa?',now())",[p.workspaceId,f.connection.id,f.sender.id,identity,conversation]);
 });
 const t=await connect(f.u);
 const conv=await call(t.access_token,'conversations_list',{});assert.equal(conv.data.conversations[0].id,conversation);assert.equal(conv.data.conversations[0].lastInbound,'Quanto custa?');assert.match(conv.data.note,/instru/i);
 const outbox=await rows('message_outbox',p.workspaceId);
 const missing=await call(t.access_token,'reply_prepare',{conversationId:'nope',text:'Oi'});assert.ok(missing.error);
 const d=await call(t.access_token,'reply_prepare',{conversationId:conversation,text:'Olá! Posso te mandar a tabela?'});assert.ok(!d.error,d.text);assert.match(d.data.warnings[0],/Nada é enviado/);
 const ok=await call(t.access_token,'action_confirm',{proposalId:d.data.proposalId,confirmation:d.data.confirmation});
 assert.equal(ok.data.url,`${base}/messages/whatsapp?conversation=${conversation}&draft=${d.data.proposalId}`);
 assert.equal(await rows('message_outbox',p.workspaceId),outbox);
 const c2=await call(t.access_token,'reply_prepare',{conversationId:conversation,text:'Outra'});
 const cancelled=await call(t.access_token,'action_cancel',{proposalId:c2.data.proposalId});assert.equal(cancelled.data.state,'cancelled');
 assert.ok((await call(t.access_token,'action_confirm',{proposalId:c2.data.proposalId,confirmation:c2.data.confirmation})).error);
});

test('07C.3b limits: 20 open proposals per connection; a removed member is refused',async()=>{
 const owner=await prospectingUser(),mate=await prospectingUser(),mp={...mate.p,workspaceId:owner.p.workspaceId};await seed(owner.p,['l1']);
 const t=await connect(owner);
 for(let i=0;i<20;i++)assert.ok(!(await call(t.access_token,'qualification_prepare',{listId:'base'})).error);
 const over=await call(t.access_token,'qualification_prepare',{listId:'base'});assert.ok(over.error);assert.match(over.text,/demais|cancele/i);
 // Review L3: a grant without actions.prepare cannot propose, even calling the database directly.
 const ro=await connect(owner,['contacts.read']),roGrant=await testAdmin(async c=>(await c.query('SELECT grant_id FROM app.mcp_token WHERE grant_id IN(SELECT id FROM app.mcp_grant WHERE workspace_id=$1 AND scopes=ARRAY[\'contacts.read\']) LIMIT 1',[owner.p.workspaceId])).rows[0].grant_id);
 void ro;
 const {withWorkspaceTransaction}=await import('../../src/server/db/transaction.ts');
 await assert.rejects(withWorkspaceTransaction(owner.p,c=>c.query("SELECT app.mcp_propose($1,'qualify-list','{\"listId\":\"base\"}','x')",[roGrant])),/ASSISTANT_ACCESS/);
 // Review L1: a proposal with neither origin is refused.
 await assert.rejects(testAdmin(c=>c.query("INSERT INTO app.assistant_proposal(workspace_id,user_id,request_id,kind,payload,summary,role_ref) VALUES($1,$2,'x','qualify-list','{}','x',NULL)",[owner.p.workspaceId,owner.p.userId])),/assistant_proposal_origin/);
 // Review L2: revoking the connection cancels what it left open.
 const {listMcpConnections,revokeMcpConnection}=await import('../../src/server/mcp/authorization.ts');
 const tGrant=await testAdmin(async c=>(await c.query("SELECT grant_id FROM app.assistant_proposal WHERE workspace_id=$1 AND state='proposed' LIMIT 1",[owner.p.workspaceId])).rows[0].grant_id);
 assert.ok((await listMcpConnections(owner.p)).some(x=>x.id===tGrant));
 await revokeMcpConnection(owner.p,tGrant);
 assert.equal(await rows('assistant_proposal',owner.p.workspaceId,`AND grant_id='${tGrant}' AND state='proposed'`),0);
 await testAdmin(c=>c.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',[randomUUID(),owner.p.workspaceId,mate.p.userId,'operator']));
 const m=await connect({...mate,p:mp});
 await testAdmin(c=>c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[owner.p.workspaceId,mate.p.userId]));
 const gone=await rpc(m.access_token,'tools/call',{name:'qualification_prepare',arguments:{listId:'base'}});assert.equal(gone.status,403);
 assert.equal(await rows('assistant_proposal',owner.p.workspaceId,`AND user_id='${mate.p.userId}'`),0);
});
