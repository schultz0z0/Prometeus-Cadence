import test from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';
import{testAdmin}from'./prospecting-helpers.ts';
import{base}from'./helpers.ts';
import{withWorkspaceTransaction}from'../../src/server/db/transaction.ts';
import{revokeLinkedinAccount}from'../../src/server/linkedin/connections.ts';
import{listLinkedinPeople,linkedinPipeline,moveLinkedinPerson,optOutLinkedinPerson}from'../../src/server/linkedin/people.ts';
import{getLinkedinThread,prepareLinkedinReply,confirmLinkedinReply,runLinkedinMessageTick}from'../../src/server/linkedin/conversations.ts';
import{linkedinPeopleRequest,linkedinPersonActionRequest,linkedinConversationActionRequest}from'../../src/server/linkedin/http.ts';
import{useLinkedinTestEnv,user,code,FULL,enable,setup,person,draft,activate,WED,ticks,rows,type Fake}from'./linkedin-helpers.ts';
import type{Principal}from'../../src/domain/workspace.ts';
useLinkedinTestEnv();
const MSG={...FULL,readMessages:true,sendMessage:'assisted'};
const at=(min:number)=>new Date(WED+min*60e3).toISOString();
/** A campaign person who accepted (07A.2 flow through the real services). */
async function accepted(caps:Record<string,unknown>=MSG){
 const s=await setup(caps);const p1=person(1),p2=person(2);s.u.people.push(p1,p2);
 const campaign=await activate(s.p,draft());await ticks(s.u,3);
 s.u.relations.push({member_id:p1.id,public_identifier:'re-p1',first_name:'[RE]',last_name:'Pessoa 1'});
 await ticks(s.u,1,WED+3*3600e3);
 const people=(await listLinkedinPeople(s.p,{})).people;
 return{...s,p1,p2,campaign,me:people.find(x=>x.name==='[RE] Pessoa 1')!,other:people.find(x=>x.name==='[RE] Pessoa 2')!};
}
const sync=(u:Fake,min:number)=>runLinkedinMessageTick({limit:10,now:new Date(WED+min*60e3)},u.deps);
function chat(u:Fake,id:string,attendee:string,messages:[string,string,0|1,number][]){u.chats.set(id,{attendee,messages:messages.map(([mid,text,is_sender,min])=>({id:mid,text,timestamp:at(min),is_sender,sender_id:is_sender?'ME':attendee}))});}
const count=(ws:string)=>rows(ws,'SELECT count(*)::int n FROM app.linkedin_message WHERE workspace_id=$1').then(r=>r[0].n);
async function reply(p:Principal,threadId:string,body:string,u:Fake,requestId:string=randomUUID()){
 const r=await prepareLinkedinReply(p,{threadId,body});return confirmLinkedinReply(p,{threadId,body,token:r.token,requestId},u.deps);
}

test('07A.3 sync: only campaign people\'s chats are kept, deduplicated; a reply moves the person to Respondeu',async()=>{
 const s=await accepted();
 chat(s.u,'chat_p1',s.p1.id,[['m1','[RE] Oi, obrigado pelo convite!',0,240],['m2','[RE] Que bom falar com você.',1,250]]);
 chat(s.u,'chat_x','ACoSTRANGER',[['m9','[RE] Mensagem de fora',0,245]]);
 await sync(s.u,300);
 assert.equal(await count(s.p.workspaceId),2,'the stranger\'s chat is not stored');
 const me=(await listLinkedinPeople(s.p,{})).people.find(x=>x.id===s.me.id)!;
 assert.equal(me.stage,'replied');assert.ok(me.threadId);
 const t=await getLinkedinThread(s.p,me.threadId!);
 assert.deepEqual(t.messages.map(m=>[m.direction,m.body]),[['in','[RE] Oi, obrigado pelo convite!'],['out','[RE] Que bom falar com você.']]);
 const col=(await linkedinPipeline(s.p)).columns.find(c=>c.id==='replied')!;assert.deepEqual(col.people.map(x=>x.id),[s.me.id]);
 await sync(s.u,320);
 assert.equal(await count(s.p.workspaceId),2,'a repeated sync adds nothing');
 assert.equal(s.u.count('GET /api/v1/chats/chat_x'),1,'an unrelated chat is resolved once');
 const other=await user();
 assert.equal(await code(()=>getLinkedinThread(other.p,me.threadId!)),'404 LINKEDIN_THREAD_NOT_FOUND');
 assert.equal((await listLinkedinPeople(other.p,{})).people.length,0);
 assert.equal((await listLinkedinPeople(s.p,{stage:'invited'})).people.some(x=>x.id===s.me.id),false,'stage filter');
});

test('07A.3 reply: reviewed text, sent once per request, never duplicated by the sync; edits and late confirms need a new review',async()=>{
 const s=await accepted();chat(s.u,'chat_p1',s.p1.id,[['m1','[RE] Oi!',0,240]]);await sync(s.u,300);
 const threadId=(await listLinkedinPeople(s.p,{})).people.find(x=>x.id===s.me.id)!.threadId!;
 const reqId=randomUUID(),review=await prepareLinkedinReply(s.p,{threadId,body:'[RE] Obrigado!'});
 assert.ok(Date.parse(review.expiresAt)-Date.now()<=61e3);
 assert.equal(await code(()=>confirmLinkedinReply(s.p,{threadId,body:'[RE] Obrigado!!',token:review.token,requestId:reqId},s.u.deps)),'409 LINKEDIN_REPLY_CHANGED');
 const r=await confirmLinkedinReply(s.p,{threadId,body:'[RE] Obrigado!',token:review.token,requestId:reqId},s.u.deps);
 assert.equal(r.state,'sent');assert.deepEqual(s.u.sent,[{chat:'chat_p1',text:'[RE] Obrigado!'}]);
 assert.equal((await confirmLinkedinReply(s.p,{threadId,body:'[RE] Obrigado!',token:review.token,requestId:reqId},s.u.deps)).state,'sent');
 assert.equal(s.u.sent.length,1,'the same request never sends twice');
 assert.equal(await code(()=>confirmLinkedinReply(s.p,{threadId,body:'[RE] Obrigado!',token:review.token,requestId:randomUUID()},s.u.deps)),'409 LINKEDIN_REPLY_USED');
 await sync(s.u,330);assert.equal(await count(s.p.workspaceId),2,'the sent message comes back from the sync without a duplicate');
 const late=await prepareLinkedinReply(s.p,{threadId,body:'[RE] Depois'});
 await testAdmin(c=>c.query("UPDATE app.linkedin_reply SET expires_at=clock_timestamp()-interval '1 second' WHERE workspace_id=$1 AND state='prepared'",[s.p.workspaceId]));
 assert.equal(await code(()=>confirmLinkedinReply(s.p,{threadId,body:'[RE] Depois',token:late.token,requestId:randomUUID()},s.u.deps)),'409 LINKEDIN_REPLY_EXPIRED','no release later than a minute after the review');
 assert.equal(s.u.sent.length,1);
});

test('07A.3 opt-out, a revoked account or a gate without messages between review and confirm send nothing; uncertain is not resent',async()=>{
 const s=await accepted();chat(s.u,'chat_p1',s.p1.id,[['m1','[RE] Oi!',0,240]]);await sync(s.u,300);
 const threadId=(await listLinkedinPeople(s.p,{})).people.find(x=>x.id===s.me.id)!.threadId!;
 let review=await prepareLinkedinReply(s.p,{threadId,body:'[RE] A'});
 await optOutLinkedinPerson(s.p,s.me.id);
 assert.equal(await code(()=>confirmLinkedinReply(s.p,{threadId,body:'[RE] A',token:review.token,requestId:randomUUID()},s.u.deps)),'409 LINKEDIN_OPTED_OUT');
 assert.equal(await code(()=>prepareLinkedinReply(s.p,{threadId,body:'[RE] B'})),'409 LINKEDIN_OPTED_OUT');
 assert.equal((await listLinkedinPeople(s.p,{})).people.find(x=>x.id===s.other.id)!.optedOut,false,'only that person');
 assert.equal(s.u.sent.length,0);
 // Another accepted person on a fresh workspace: uncertain, then revoke between review and confirm.
 const t=await accepted();chat(t.u,'chat_q',t.p1.id,[['q1','[RE] Olá',0,240]]);await sync(t.u,300);
 const tid=(await listLinkedinPeople(t.p,{})).people.find(x=>x.id===t.me.id)!.threadId!;
 t.u.hooks.send='timeout';const req=randomUUID();review=await prepareLinkedinReply(t.p,{threadId:tid,body:'[RE] C'});
 assert.equal((await confirmLinkedinReply(t.p,{threadId:tid,body:'[RE] C',token:review.token,requestId:req},t.u.deps)).state,'uncertain');
 t.u.hooks.send=undefined;
 assert.equal((await confirmLinkedinReply(t.p,{threadId:tid,body:'[RE] C',token:review.token,requestId:req},t.u.deps)).state,'uncertain');
 assert.equal(t.u.sent.length,1,'uncertain: never resent');
 await enable({...MSG,sendMessage:'unavailable'});
 assert.equal(await code(()=>prepareLinkedinReply(t.p,{threadId:tid,body:'[RE] D'})),'409 LINKEDIN_UNAVAILABLE');
 await enable(MSG);
 review=await prepareLinkedinReply(t.p,{threadId:tid,body:'[RE] E'}).catch(()=>null) as never;
 const acc=await rows(t.p.workspaceId,"SELECT id,revision FROM app.linkedin_account WHERE workspace_id=$1 AND state<>'revoked'");
 await revokeLinkedinAccount(t.p,acc[0].id,{expectedRevision:Number(acc[0].revision)},t.u.deps);
 assert.equal(await code(()=>prepareLinkedinReply(t.p,{threadId:tid,body:'[RE] F'})),'409 LINKEDIN_ACCOUNT_NOT_READY');
 assert.equal(t.u.sent.length,1);
});

test('07A.3 pipeline moves: only after the acceptance, by revision and request id; other workspaces get 404',async()=>{
 const s=await accepted();
 const me=(await listLinkedinPeople(s.p,{})).people.find(x=>x.id===s.me.id)!;assert.equal(me.stage,'accepted');
 const req=randomUUID(),moved=await moveLinkedinPerson(s.p,{personId:me.id,stage:'replied',expectedRevision:me.stageRevision,requestId:req});
 assert.equal(moved.stage,'replied');
 assert.deepEqual(await moveLinkedinPerson(s.p,{personId:me.id,stage:'replied',expectedRevision:me.stageRevision,requestId:req}),moved,'same request: same result');
 assert.equal(await code(()=>moveLinkedinPerson(s.p,{personId:me.id,stage:'accepted',expectedRevision:me.stageRevision,requestId:randomUUID()})),'409 REVISION_CONFLICT');
 const other=(await listLinkedinPeople(s.p,{})).people.find(x=>x.id===s.other.id)!;
 assert.equal(await code(()=>moveLinkedinPerson(s.p,{personId:other.id,stage:'replied',expectedRevision:other.stageRevision,requestId:randomUUID()})),'409 LINKEDIN_STAGE_LOCKED');
 const x=await user();
 assert.equal(await code(()=>moveLinkedinPerson(x.p,{personId:me.id,stage:'accepted',expectedRevision:moved.revision,requestId:randomUUID()})),'404 LINKEDIN_PERSON_NOT_FOUND');
});

test('07A.3 HTTP and SQL boundaries',async()=>{
 const s=await accepted();
 const post=(h:Headers|null,body:unknown,path:string)=>new Request(base+path,{method:'POST',headers:{...(h?Object.fromEntries(h):{}),origin:base,'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await linkedinPeopleRequest(new Request(base+'/api/linkedin/people'))).status,401);
 const got=await linkedinPeopleRequest(new Request(base+'/api/linkedin/people?stage=accepted',{headers:s.headers}));
 assert.equal(got.status,200);assert.equal(got.headers.get('cache-control'),'no-store');
 const text=await got.text();assert.equal(text.includes(s.p1.id),false,'no LinkedIn ids reach the browser');
 assert.equal((await linkedinPersonActionRequest(post(s.headers,{},`/api/linkedin/people/${s.me.id}/explode`),s.me.id,'explode')).status,404);
 assert.equal((await linkedinConversationActionRequest(post(s.headers,{body:''},`/api/linkedin/conversations/${randomUUID()}/prepare-reply`),randomUUID(),'prepare-reply')).status,422);
 const denied:string[]=[];
 for(const sql of ['SELECT token_hash FROM app.linkedin_reply',"SELECT app.claim_linkedin_messages(now(),1,'t')",'SELECT remote_chat_id FROM app.linkedin_thread'])
  denied.push(await withWorkspaceTransaction(s.p,c=>c.query(sql)).then(()=>'ok',(e:{code?:string})=>e.code!));
 assert.deepEqual(denied,['42501','42501','42501']);
});

test('07A.3 review: a missing vendor key sends nothing and leaves nothing uncertain (reply and invite)',async()=>{
 const s=await accepted();chat(s.u,'chat_p1',s.p1.id,[['m1','[RE] Oi!',0,240]]);await sync(s.u,300);
 const threadId=(await listLinkedinPeople(s.p,{})).people.find(x=>x.id===s.me.id)!.threadId!;
 const review=await prepareLinkedinReply(s.p,{threadId,body:'[RE] Sem chave'});
 const dsn=process.env.UNIPILE_DSN;delete process.env.UNIPILE_DSN;
 try{
  assert.equal(await code(()=>confirmLinkedinReply(s.p,{threadId,body:'[RE] Sem chave',token:review.token,requestId:randomUUID()},s.u.deps)),'503 LINKEDIN_NOT_CONFIGURED');
  assert.deepEqual((await rows(s.p.workspaceId,'SELECT state FROM app.linkedin_reply WHERE workspace_id=$1')).map(r=>r.state),['prepared']);
  // A queued invite with no key goes back to the queue instead of becoming uncertain.
  const before=(await rows(s.p.workspaceId,"SELECT count(*)::int n FROM app.linkedin_campaign_person WHERE workspace_id=$1 AND state='uncertain'"))[0].n;
  s.u.people.push(person(9));await testAdmin(c=>c.query("UPDATE app.linkedin_campaign SET collect_done=false,collect_cursor=NULL WHERE workspace_id=$1",[s.p.workspaceId]));
  process.env.UNIPILE_DSN=dsn;await ticks(s.u,1,WED+24*3600e3);delete process.env.UNIPILE_DSN;
  await ticks(s.u,2,WED+25*3600e3);
  assert.equal((await rows(s.p.workspaceId,"SELECT count(*)::int n FROM app.linkedin_campaign_person WHERE workspace_id=$1 AND state='uncertain'"))[0].n,before);
 }finally{process.env.UNIPILE_DSN=dsn;}
 assert.equal(s.u.sent.length,0);
});
