import test,{after}from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';
import{prospectingUser,testAdmin,closeProspectingPools}from'./prospecting-helpers.ts';
import{verifiedMetaFixture}from'./whatsapp-helpers.ts';
import{executeWorkspaceCommand,readWorkspaceSnapshot}from'../../src/server/workspaces/commands.ts';
import{withWorkspaceTransaction}from'../../src/server/db/transaction.ts';
import{scanDuplicates,prepareMerge,confirmMerge,listMerges,undoMerge}from'../../src/server/privacy/merge.ts';
import{readPrivacy,savePrivacy}from'../../src/server/privacy/service.ts';
import{purgeExpiredMessageText}from'../../src/server/privacy/worker.ts';
import{dataLifecycleRequest,dataLifecycleItemRequest}from'../../src/server/privacy/http.ts';
import{readConversation}from'../../src/server/messaging/inbox.ts';
import{identityAction}from'../../src/server/workspaces/service.ts';
import{requirePrincipal}from'../../src/server/auth/principal.ts';
import{verifiedUser,base}from'./helpers.ts';
import type{Principal}from'../../src/domain/workspace.ts';
after(closeProspectingPools);
const lead=(id:string,listId:string,createdAt:string,fields:Record<string,unknown>={})=>({id,listId,name:'Contato '+id,qualification:'pending',source:'MANUAL',createdAt,...fields});
const day=(n:number)=>new Date(Date.UTC(2026,0,1)+n*86400000).toISOString();
async function seed(p:Principal,leads:ReturnType<typeof lead>[],list={id:'base',name:'Base'}){const s=await readWorkspaceSnapshot(p);await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'leads.import',dedupScope:'list',list,leads}});}
const other={id:'other',name:'Outra'};
const consumed=(ws:string)=>testAdmin(async c=>Number((await c.query("SELECT count(*) FROM app.billing_consumption WHERE workspace_id=$1 AND key LIKE 'lead:%'",[ws])).rows[0].count));
async function job(ws:string,actor:string){const id=randomUUID();await testAdmin(c=>c.query("INSERT INTO app.prospecting_job(workspace_id,id,actor_id,list_id,request_id,body_hash,kind,source,state,input,profile_version) VALUES($1,$2,$3,'base',$4,'x','generation','MAPS','completed','{}','x')",[ws,id,actor,randomUUID()]));return id;}
async function merge(p:Principal,groups:{targetId:string;sourceIds:string[];kind:'cnpj'|'email'|'phone';value:string}[],requestId=randomUUID()){const review=await prepareMerge(p,{groups});assert.deepEqual(review.blockers,[]);return{requestId,review,result:await confirmMerge(p,{groups,token:review.token,requestId})};}

test('full-base scan finds a duplicate beyond the first contacts page; equal names never group',async()=>{
 const{p}=await prospectingUser();
 const many=Array.from({length:60},(_,i)=>lead('n'+i,'base',day(i+1),{name:'Mesmo Nome',city:'São Paulo',site:'https://same.example'}));
 await seed(p,[lead('old','base',day(0),{email:'Dup@Example.com'}),...many]);await seed(p,[lead('new','other',day(90),{email:' dup@example.com '})],other);
 const{groups}=await scanDuplicates(p);
 assert.deepEqual(groups.map(g=>[g.kind,g.value,g.ids]),[['email','dup@example.com',['old','new']]]);
 assert.equal(groups[0].leads[0].id,'old');
});

test('merge fills empty fields, moves links, extends opt-out, replays without new quota and undo restores before edits',async()=>{
 const{p}=await prospectingUser(),ws=p.workspaceId,actor=p.userId;
 await seed(p,[lead('keep','base',day(0),{email:'a@example.com',phone:''})]);await seed(p,[lead('gone','other',day(5),{email:'a@example.com',phone:'+55 11 99999-0000',city:'Recife'})],other);
 const jobId=await job(ws,actor),identity=randomUUID();
 await testAdmin(async c=>{
  await c.query("INSERT INTO app.lead_evidence(workspace_id,id,lead_id,job_id,url,text,hash,truncated,fetched_at) VALUES($1,'ev1','gone',$2,'https://gone.example','evidência','h',false,now())",[ws,jobId]);
  await c.query("INSERT INTO app.channel_identity(workspace_id,id,scope,external_id,phone) VALUES($1,$2,'meta:qa','5511999990000','+5511999990000')",[ws,identity]);
  await c.query("INSERT INTO app.contact_suppression(workspace_id,identity_id,scope,reason) VALUES($1,$2,'all','QA opt-out')",[ws,identity]);
 });
 const before=await consumed(ws);
 const{requestId,review,result}=await merge(p,[{targetId:'keep',sourceIds:['gone'],kind:'email',value:'a@example.com'}]);
 assert.equal(review.removed,1);assert.equal(result.merged,1);assert.deepEqual(result.failures,[]);
 const after1=await readWorkspaceSnapshot(p),kept=after1.data.leads.find(l=>l.id==='keep')!;
 assert.equal(after1.data.leads.some(l=>l.id==='gone'),false);assert.equal(kept.phone,'+55 11 99999-0000');assert.equal(kept.city,'Recife');assert.equal(kept.email,'a@example.com');
 assert.equal(await testAdmin(async c=>(await c.query("SELECT lead_id FROM app.lead_evidence WHERE workspace_id=$1 AND id='ev1'",[ws])).rows[0].lead_id),'keep');
 // Replaying the same confirmation neither creates a second merge nor consumes quota.
 const replay=await confirmMerge(p,{groups:[{targetId:'keep',sourceIds:['gone'],kind:'email',value:'a@example.com'}],token:review.token,requestId});
 assert.deepEqual(replay.mergeIds,result.mergeIds);assert.equal(await consumed(ws),before);
 assert.equal((await listMerges(p)).length,1);
 // Edited target: undo would overwrite newer work, so it is refused.
 const s=await readWorkspaceSnapshot(p);await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'lead.upsert',lead:{...kept,name:'Editado'}}});
 await assert.rejects(undoMerge(p,result.mergeIds[0],{requestId:randomUUID()}),{status:409,code:'MERGE_CONFLICT'});
 const s2=await readWorkspaceSnapshot(p);await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:s2.revision,command:{type:'lead.upsert',lead:kept}});
 const undo=randomUUID(),view=await undoMerge(p,result.mergeIds[0],{requestId:undo});assert.equal(view.state,'undone');
 assert.equal((await undoMerge(p,result.mergeIds[0],{requestId:undo})).state,'undone');
 const restored=await readWorkspaceSnapshot(p);assert.ok(restored.data.leads.some(l=>l.id==='gone'));
 assert.equal(await testAdmin(async c=>(await c.query("SELECT lead_id FROM app.lead_evidence WHERE workspace_id=$1 AND id='ev1'",[ws])).rows[0].lead_id),'gone');
 assert.equal(await consumed(ws),before);
 await assert.rejects(undoMerge(p,result.mergeIds[0],{requestId:randomUUID()}),{status:409,code:'MERGE_ALREADY_UNDONE'});
});

test('the most restrictive consent survives a merge and is removed again by undo',async()=>{
 const{p}=await prospectingUser(),ws=p.workspaceId;
 await seed(p,[lead('t','base',day(0),{cnpj:'12.345.678/0001-95',email:'t@example.com'})]);await seed(p,[lead('s','other',day(1),{cnpj:'12345678000195',email:'s@example.com'})],other);
 const sid=randomUUID();await testAdmin(async c=>{await c.query("INSERT INTO app.channel_identity(workspace_id,id,scope,external_id) VALUES($1,$2,'email','s@example.com')",[ws,sid]);await c.query("INSERT INTO app.contact_suppression(workspace_id,identity_id,scope,reason) VALUES($1,$2,'all','QA opt-out')",[ws,sid]);});
 const{result}=await merge(p,[{targetId:'t',sourceIds:['s'],kind:'cnpj',value:'12345678000195'}]);
 const suppressed=()=>testAdmin(async c=>Number((await c.query("SELECT count(*) FROM app.contact_suppression cs JOIN app.channel_identity ci ON ci.workspace_id=cs.workspace_id AND ci.id=cs.identity_id WHERE cs.workspace_id=$1 AND ci.external_id='t@example.com'",[ws])).rows[0].count));
 assert.equal(await suppressed(),1);
 await undoMerge(p,result.mergeIds[0],{requestId:randomUUID()});assert.equal(await suppressed(),0);
 assert.equal(await testAdmin(async c=>Number((await c.query("SELECT count(*) FROM app.contact_suppression WHERE workspace_id=$1 AND identity_id=$2",[ws,sid])).rows[0].count)),1);
});

test('a conflicting group fails alone while the others merge; stale reviews are refused',async()=>{
 const{p}=await prospectingUser(),ws=p.workspaceId;
 await seed(p,[lead('a1','base',day(0),{email:'a@example.com'}),lead('b1','base',day(0),{email:'b@example.com'})]);await seed(p,[lead('a2','other',day(1),{email:'a@example.com'}),lead('b2','other',day(1),{email:'b@example.com'})],other);
 const jobId=await job(ws,p.userId);await testAdmin(c=>c.query("INSERT INTO app.research_case(workspace_id,id,job_id,lead_id,case_version,name,basis) VALUES($1,$2,$3,'b2',1,'Caso','{}')",[ws,randomUUID(),jobId]));
 const groups=[{targetId:'a1',sourceIds:['a2'],kind:'email' as const,value:'a@example.com'},{targetId:'b1',sourceIds:['b2'],kind:'email' as const,value:'b@example.com'}];
 const review=await prepareMerge(p,{groups}),s=await readWorkspaceSnapshot(p);
 await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'lead.upsert',lead:{...s.data.leads.find(l=>l.id==='a2')!,city:'Mudou'}}});
 await assert.rejects(confirmMerge(p,{groups,token:review.token,requestId:randomUUID()}),{status:409});
 const{result}=await merge(p,groups);
 assert.equal(result.merged,1);assert.equal(result.failures.length,1);assert.equal(result.failures[0].targetId,'b1');
 const ids=(await readWorkspaceSnapshot(p)).data.leads.map(l=>l.id).sort();assert.deepEqual(ids,['a1','b1','b2']);
});

test('deleting a contact purges its AI content and cache, keeps a content-free tombstone, and never touches another tenant',async()=>{
 const a=await prospectingUser(),b=await prospectingUser(),ws=a.p.workspaceId;
 await seed(a.p,[lead('x','base',day(0),{email:'x@example.com'})]);await seed(b.p,[lead('x','base',day(0),{email:'x@example.com'})]);
 const jobId=await job(ws,a.p.userId),other=await job(b.p.workspaceId,b.p.userId);
 await testAdmin(async c=>{for(const[w,j,u]of[[ws,jobId,a.p.userId],[b.p.workspaceId,other,b.p.userId]]){
  await c.query("SELECT set_config('app.workspace_id',$1,false),set_config('app.user_id',$2,false)",[w,u]);
  await c.query("INSERT INTO app.research_case(workspace_id,id,job_id,lead_id,case_version,name,basis) VALUES($1,$2,$3,'x',1,'Caso','{}')",[w,randomUUID(),j]);
  await c.query("INSERT INTO app.research_fact(workspace_id,job_id,id,lead_id,field,value,evidence,attribution) VALUES($1,$2,$3,'x','email','x@example.com','[{\"id\":\"e\"}]','company')",[w,j,randomUUID()]);
  await c.query("INSERT INTO app.research_source(workspace_id,job_id,id,lead_id,url,text,hash,fetched_at,source_kind,attribution,links) VALUES($1,$2,$3,'x','https://x.example','conteúdo da página','h',now(),'website','company','[]')",[w,j,randomUUID()]);
  await c.query("INSERT INTO app.prospecting_cache VALUES($1,$2,'{\"decision\":\"x\"}',now())",[w,randomUUID()]);
  await c.query("INSERT INTO app.prospecting_item(workspace_id,job_id,id,lead_id,name,status,payload) VALUES($1,$2,$3,'x','Empresa X','applied','{\"email\":\"x@example.com\"}')",[w,j,randomUUID()]);
 }});
 const s=await readWorkspaceSnapshot(a.p);await executeWorkspaceCommand(a.p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'leads.delete',ids:['x']}});
 const counts=(w:string)=>testAdmin(async c=>(await c.query("SELECT (SELECT count(*) FROM app.research_fact WHERE workspace_id=$1)::int facts,(SELECT count(*) FROM app.research_source WHERE workspace_id=$1)::int sources,(SELECT count(*) FROM app.prospecting_cache WHERE workspace_id=$1)::int cache,(SELECT count(*) FROM app.prospecting_item WHERE workspace_id=$1 AND (lead_id IS NOT NULL OR payload<>'{}'))::int items,(SELECT count(*) FROM app.data_tombstone WHERE workspace_id=$1)::int tombstones",[w])).rows[0]);
 assert.deepEqual(await counts(ws),{facts:0,sources:0,cache:0,items:0,tombstones:1});
 assert.deepEqual(await counts(b.p.workspaceId),{facts:1,sources:1,cache:1,items:1,tombstones:0});
 const tomb=await testAdmin(async c=>(await c.query('SELECT * FROM app.data_tombstone WHERE workspace_id=$1',[ws])).rows[0]);assert.deepEqual(Object.keys(tomb).sort(),['actor_id','deleted_at','lead_id','workspace_id']);
});

test('retention is owner-only, typed-confirmed, keeps recent text, purges old text per direction and isolates tenants',async()=>{
 const f=await verifiedMetaFixture(),g=await verifiedMetaFixture(),p=f.u.p;
 const messages=async(fx:typeof f,ages:[string,number][])=>{const identity=randomUUID(),conversation=randomUUID();await testAdmin(async c=>{
  await c.query("INSERT INTO app.channel_identity(workspace_id,id,scope,external_id) VALUES($1,$2,'fixture',$2)",[fx.u.p.workspaceId,identity]);
  await c.query("INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id,channel) VALUES($1,$2,$3,$4,$5,'WHATSAPP')",[fx.u.p.workspaceId,conversation,fx.connection.id,fx.sender.id,identity]);
  for(const[direction,days]of ages)await c.query("INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,state,text,occurred_at,created_at) VALUES($1,gen_random_uuid()::text,$2,$3,$4,$5,$6,$7,$8,now()-make_interval(days=>$9),now()-make_interval(days=>$9))",[fx.u.p.workspaceId,fx.connection.id,fx.sender.id,identity,conversation,direction,direction==='inbound'?'received':'accepted',direction+' '+days,days]);
 });return conversation;};
 const conversation=await messages(f,[['outbound',22],['outbound',40],['inbound',40],['inbound',100]]);await messages(g,[['outbound',400],['inbound',400]]);
 const view=await readPrivacy(p);assert.equal(view.canManage,true);assert.equal(view.retention.active,false);
 await assert.rejects(savePrivacy(p,{active:true,sentDays:30,replyDays:90,expectedRevision:0}),{status:422,code:'RETENTION_CONFIRM'});
 await assert.rejects(savePrivacy(p,{active:true,sentDays:7,replyDays:90,expectedRevision:0,confirm:'APAGAR'}),{status:422});
 const saved=await savePrivacy(p,{active:true,sentDays:30,replyDays:90,expectedRevision:0,confirm:'APAGAR'});assert.equal(saved.retention.revision,1);
 await assert.rejects(savePrivacy(p,{active:true,sentDays:30,replyDays:90,expectedRevision:0,confirm:'APAGAR'}),{status:409});
 assert.equal((await savePrivacy(p,{active:true,sentDays:60,replyDays:90,expectedRevision:1})).retention.sentDays,60);
 await savePrivacy(p,{active:true,sentDays:30,replyDays:90,expectedRevision:2,confirm:'APAGAR'});
 const{purged}=await purgeExpiredMessageText({limit:1,signal:new AbortController().signal});assert.ok(purged>=2);
 const texts=await testAdmin(async c=>(await c.query('SELECT workspace_id=$1 own,direction,text,text_purged_at IS NOT NULL purged FROM app.channel_message WHERE workspace_id IN($1,$2) ORDER BY workspace_id=$1,direction,created_at DESC',[p.workspaceId,g.u.p.workspaceId])).rows);
 assert.deepEqual(texts.filter(r=>r.own).map(r=>[r.direction,r.text]),[['inbound','inbound 40'],['inbound',null],['outbound','outbound 22'],['outbound',null]]);
 assert.ok(texts.filter(r=>!r.own).every(r=>r.text!==null&&!r.purged));
 const thread=await readConversation(p,conversation);assert.equal(thread.messages.filter(m=>m.text==='texto indisponível').length,2);
 // A non-owner neither reads nor changes the policy.
 const op=await verifiedUser(),opHeaders=new Headers({cookie:op.cookie,origin:base});
 await testAdmin(c=>c.query("INSERT INTO auth.member(id,\"organizationId\",\"userId\",role,\"createdAt\") VALUES($1,$2,$3,'admin',now())",[randomUUID(),p.workspaceId,op.user.id]));
 await identityAction(opHeaders,{type:'switch',workspaceId:p.workspaceId});const admin=await requirePrincipal(opHeaders);
 assert.equal((await readPrivacy(admin)).canManage,false);
 await assert.rejects(savePrivacy(admin,{active:false,sentDays:30,replyDays:90,expectedRevision:3}),{status:403});
});

test('HTTP contract: anonymous 401, wrong workspace 409, invalid input 422 and idempotent undo',async()=>{
 const anon=await dataLifecycleRequest(new Request(base+'/api/data-lifecycle?view=merges'));assert.equal(anon.status,401);
 const{p,headers}=await prospectingUser();
 await seed(p,[lead('h1','base',day(0),{phone:'(11) 98888-7777'})]);await seed(p,[lead('h2','other',day(1),{phone:'+5511988887777'})],other);
 const post=(body:unknown,h=headers)=>dataLifecycleRequest(new Request(base+'/api/data-lifecycle',{method:'POST',headers:h,body:JSON.stringify(body)}));
 const wrong=new Headers(headers);wrong.set('x-cadence-workspace',randomUUID());assert.equal((await post({action:'scan'},wrong)).status,409);
 assert.equal((await post({action:'prepare-merge',input:{groups:[{targetId:'h1',sourceIds:['h2'],kind:'name_city',value:'x'}]}})).status,422);
 const scan=await(await post({action:'scan'})).json();assert.deepEqual(scan.groups[0].ids,['h1','h2']);assert.equal(scan.groups[0].value,'11988887777');
 const groups=[{targetId:'h1',sourceIds:['h2'],kind:'phone',value:'11988887777'}];
 const review=await(await post({action:'prepare-merge',input:{groups}})).json();
 const done=await(await post({action:'confirm-merge',input:{groups,token:review.token,requestId:randomUUID()}})).json();assert.equal(done.merged,1);
 const requestId=randomUUID(),undo=()=>dataLifecycleItemRequest(new Request(base+'/api/data-lifecycle/'+done.mergeIds[0]+'/undo',{method:'POST',headers,body:JSON.stringify({requestId})}),done.mergeIds[0],'undo');
 assert.equal((await undo()).status,200);assert.equal((await undo()).status,200);
 const merges=await(await dataLifecycleRequest(new Request(base+'/api/data-lifecycle?view=merges',{headers}))).json();assert.equal(merges.merges[0].state,'undone');
});
