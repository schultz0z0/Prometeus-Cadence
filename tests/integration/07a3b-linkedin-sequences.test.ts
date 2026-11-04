import test from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';
import{testAdmin}from'./prospecting-helpers.ts';
import{base}from'./helpers.ts';
import{withWorkspaceTransaction}from'../../src/server/db/transaction.ts';
import{revokeLinkedinAccount}from'../../src/server/linkedin/connections.ts';
import{listLinkedinTemplates,saveLinkedinTemplate,archiveLinkedinTemplate}from'../../src/server/linkedin/templates.ts';
import{listLinkedinSequences,saveLinkedinSequence,linkedinSequenceAction,runLinkedinSequenceTick}from'../../src/server/linkedin/sequences.ts';
import{listLinkedinPeople,optOutLinkedinPerson}from'../../src/server/linkedin/people.ts';
import{prepareLinkedinReply,confirmLinkedinReply,runLinkedinMessageTick}from'../../src/server/linkedin/conversations.ts';
import{linkedinTemplatesRequest,linkedinSequencesRequest}from'../../src/server/linkedin/http.ts';
import{useLinkedinTestEnv,user,code,FULL,enable,setup,draft,activate,WED,rows,type Fake}from'./linkedin-helpers.ts';
import type{Principal}from'../../src/domain/workspace.ts';
useLinkedinTestEnv();
const AUTO={...FULL,readMessages:true,sendMessage:'automatic'},ASSIST={...FULL,readMessages:true,sendMessage:'assisted'};
const at=(min:number)=>new Date(WED+min*60e3).toISOString();
async function base0(caps:Record<string,unknown>=AUTO){const s=await setup(caps);const campaign=await activate(s.p,draft());return{...s,campaign};}
/** People who accepted (fixtures straight in the campaign: the acceptance flow itself is 07A.2's). */
async function accepted(s:{p:Principal},campaign:string,n:number,o:{company?:string|null;offset?:number}={}){
 const ids:string[]=[];
 for(let i=0;i<n;i++){const id=randomUUID(),ext='ACoS'+randomUUID().slice(0,10);ids.push(id);
  await testAdmin(c=>c.query("INSERT INTO app.linkedin_campaign_person(workspace_id,campaign_id,id,external_id,name,headline,company,state,invited_at,accepted_at) VALUES($1,$2,$3,$4,$5,'Diretor',$6,'accepted',$7,$7)",
   [s.p.workspaceId,campaign,id,ext,`[RE] Aceite ${i+(o.offset??0)}`,o.company===null?null:o.company??`[RE] Empresa ${i+(o.offset??0)}`,at(-60)]));}
 return ids;
}
const steps=[{delayDays:0,body:'[RE] Obrigado por aceitar, {nome}!'},{delayDays:2,body:'[RE] Posso ajudar a {empresa}?'}];
async function start(p:Principal,campaignId:string,st=steps){
 const r=await saveLinkedinSequence(p,{id:randomUUID(),expectedRevision:0,sequence:{name:'[RE] Pós-aceite',campaignId,steps:st}});
 const a=await linkedinSequenceAction(p,r.id,'activate',{expectedRevision:r.revision});return{id:r.id,revision:a.revision};
}
const tick=(u:Fake,min:number)=>runLinkedinSequenceTick({limit:10,now:new Date(WED+min*60e3)},u.deps);
async function ticks(u:Fake,from:number,n:number,step=6){for(let i=0;i<n;i++)await tick(u,from+i*step);}
const runs=(ws:string)=>rows(ws,'SELECT state,reason,step_index FROM app.linkedin_sequence_run WHERE workspace_id=$1 ORDER BY created_at').then(r=>r);

test('07A.3b templates: revisions, kinds and workspaces',async()=>{
 const s=await base0(),id=randomUUID();
 const t=await saveLinkedinTemplate(s.p,{id,expectedRevision:0,template:{name:'[RE] Convite curto',kind:'invite',body:'Olá, {nome}!'}});assert.equal(t.revision,1);
 assert.equal(await code(()=>saveLinkedinTemplate(s.p,{id,expectedRevision:0,template:{name:'x',kind:'invite',body:'y'}})),'409 REVISION_CONFLICT');
 assert.equal(await code(()=>saveLinkedinTemplate(s.p,{id,expectedRevision:1,template:{name:'x',kind:'invite',body:'a'.repeat(301)}})),'422');
 const other=await user();
 assert.equal(await code(()=>saveLinkedinTemplate(other.p,{id,expectedRevision:1,template:{name:'x',kind:'message',body:'y'}})),'404 LINKEDIN_TEMPLATE_NOT_FOUND');
 assert.equal((await listLinkedinTemplates(other.p)).templates.length,0);
 await archiveLinkedinTemplate(s.p,id,{expectedRevision:1});
 assert.equal((await listLinkedinTemplates(s.p)).templates.length,0,'archived templates leave the list');
});

test('07A.3b activation: needs message sending, owner/admin, one active per campaign; an active sequence is frozen',async()=>{
 const s=await base0(FULL);
 const r=await saveLinkedinSequence(s.p,{id:randomUUID(),expectedRevision:0,sequence:{name:'[RE] A',campaignId:s.campaign,steps}});
 assert.equal(await code(()=>linkedinSequenceAction(s.p,r.id,'activate',{expectedRevision:r.revision})),'409 LINKEDIN_UNAVAILABLE');
 await enable(AUTO);
 await testAdmin(c=>c.query('UPDATE auth.member SET role=$3 WHERE "organizationId"=$1 AND "userId"=$2',[s.p.workspaceId,s.p.userId,'operator']));
 assert.equal(await code(()=>linkedinSequenceAction(s.p,r.id,'activate',{expectedRevision:r.revision})),'403 LINKEDIN_CAMPAIGN_ACCESS');
 await testAdmin(c=>c.query('UPDATE auth.member SET role=$3 WHERE "organizationId"=$1 AND "userId"=$2',[s.p.workspaceId,s.p.userId,'owner']));
 const a=await linkedinSequenceAction(s.p,r.id,'activate',{expectedRevision:r.revision});
 assert.equal(await code(()=>start(s.p,s.campaign)),'409 LINKEDIN_SEQUENCE_EXISTS');
 assert.equal(await code(()=>saveLinkedinSequence(s.p,{id:r.id,expectedRevision:a.revision,sequence:{name:'[RE] B',campaignId:s.campaign,steps}})),'409 LINKEDIN_SEQUENCE_LOCKED');
 const mine=(await listLinkedinSequences(s.p)).sequences.find(x=>x.id===r.id)!;assert.equal(mine.state,'active');assert.equal(mine.campaign.id,s.campaign);
 const other=await user();
 assert.equal(await code(()=>linkedinSequenceAction(other.p,r.id,'pause',{expectedRevision:a.revision})),'404 LINKEDIN_SEQUENCE_NOT_FOUND');
});

test('07A.3b automatic: first step starts the chat, the next one waits its days; a missing fact stops that person only',async()=>{
 const s=await base0();const [p1]=await accepted(s,s.campaign,1);await accepted(s,s.campaign,1,{company:null,offset:1});
 await start(s.p,s.campaign);
 await ticks(s.u,0,2);
 assert.deepEqual(s.u.sent.map(x=>x.text),['[RE] Obrigado por aceitar, [RE] Aceite 0!','[RE] Obrigado por aceitar, [RE] Aceite 1!']);
 assert.equal(s.u.count('POST /api/v1/chats'),2,'a new chat with each relation');
 assert.ok((await listLinkedinPeople(s.p,{})).people.find(x=>x.id===p1)!.threadId,'the started chat is a conversation');
 await ticks(s.u,24*60,2);assert.equal(s.u.sent.length,2,'step 2 waits two days');
 await ticks(s.u,2*24*60+30,2);
 assert.deepEqual(s.u.sent.map(x=>x.text).slice(2),['[RE] Posso ajudar a [RE] Empresa 0?'],'the one without {empresa} stops before step 2');
 assert.deepEqual((await runs(s.p.workspaceId)).map(r=>r.state).sort(),['done','stopped']);
 await ticks(s.u,4*24*60,2);assert.equal(s.u.sent.length,3,'nothing after the last step');
});

test('07A.3b a reply, an opt-out, a pause or a revoked account stops the sequence; uncertain is never resent',async()=>{
 const s=await base0();const [p1,p2,p3]=await accepted(s,s.campaign,3);
 const sq=await start(s.p,s.campaign);
 await ticks(s.u,0,4);assert.equal(s.u.sent.length,3);
 // p1 answers in the chat the sequence started.
 const chat=[...s.u.chats].find(([,c])=>c.messages.some(m=>m.text.includes('Aceite 0')))!;chat[1].messages.push({id:'in1',text:'[RE] Obrigado!',timestamp:at(60),is_sender:0,sender_id:chat[1].attendee});
 await runLinkedinMessageTick({limit:10,now:new Date(WED+90*60e3)},s.u.deps);
 await optOutLinkedinPerson(s.p,p2);
 await ticks(s.u,2*24*60+30,3);
 assert.equal(s.u.sent.filter(x=>x.text.includes('Posso ajudar')).length,1,'only p3 gets step 2');
 const r=await runs(s.p.workspaceId);assert.deepEqual(r.map(x=>x.reason).filter(Boolean).sort(),['opted_out','replied']);
 // Paused: nothing more. Uncertain: stops, never resent.
 const t=await base0();const [q1,q2]=await accepted(t,t.campaign,2);const tq=await start(t.p,t.campaign);
 t.u.hooks.send='timeout';await tick(t.u,0);t.u.hooks.send=undefined;
 await linkedinSequenceAction(t.p,tq.id,'pause',{expectedRevision:tq.revision});
 await ticks(t.u,10,3);
 assert.equal(t.u.sent.length,1,'paused, and the uncertain send is not repeated');
 assert.deepEqual((await runs(t.p.workspaceId)).map(x=>x.reason).filter(Boolean),['uncertain']);
 const acc=await rows(t.p.workspaceId,"SELECT id,revision FROM app.linkedin_account WHERE workspace_id=$1 AND state<>'revoked'");
 await linkedinSequenceAction(t.p,tq.id,'resume',{expectedRevision:tq.revision+1});
 await revokeLinkedinAccount(t.p,acc[0].id,{expectedRevision:Number(acc[0].revision)},t.u.deps);
 await ticks(t.u,30,3);assert.equal(t.u.sent.length,1,'revoked account: nothing');
 void p3;void q1;void q2;void sq;
});

test('07A.3b automatic sending: 30 a day per LinkedIn member, 5 minutes apart, business hours',async()=>{
 const s=await base0();await accepted(s,s.campaign,32);await start(s.p,s.campaign,[{delayDays:0,body:'[RE] Oi, {nome}'}]);
 await ticks(s.u,-120,5,5);assert.equal(s.u.sent.length,0,'before 9h in Brasília');
 await ticks(s.u,0,40,5);assert.equal(s.u.sent.length,30);
 await ticks(s.u,24*60,5,5);assert.equal(s.u.sent.length,32);
});

test('07A.3b assisted: a draft waits for the person to review and send it; then the sequence moves on',async()=>{
 const s=await base0(ASSIST);const [p1]=await accepted(s,s.campaign,1);await start(s.p,s.campaign);
 await ticks(s.u,0,2);
 assert.equal(s.u.sent.length,0,'assisted never sends by itself');
 const me=(await listLinkedinPeople(s.p,{})).people.find(x=>x.id===p1)!;
 assert.equal(me.draft,'[RE] Obrigado por aceitar, [RE] Aceite 0!');assert.equal(me.threadId,null);
 const review=await prepareLinkedinReply(s.p,{personId:p1,body:me.draft!});
 assert.equal((await confirmLinkedinReply(s.p,{personId:p1,body:me.draft!,token:review.token,requestId:randomUUID()},s.u.deps)).state,'sent');
 assert.equal(s.u.count('POST /api/v1/chats'),1,'the reviewed message starts the chat');
 const after=(await listLinkedinPeople(s.p,{})).people.find(x=>x.id===p1)!;assert.equal(after.draft,null);assert.ok(after.threadId);
 await ticks(s.u,2*24*60+30,2);
 assert.equal((await listLinkedinPeople(s.p,{})).people.find(x=>x.id===p1)!.draft,'[RE] Posso ajudar a [RE] Empresa 0?');
 assert.equal(s.u.sent.length,1);
});

test('07A.3b HTTP and SQL boundaries',async()=>{
 const s=await base0();
 const post=(h:Headers|null,body:unknown,path:string)=>new Request(base+path,{method:'POST',headers:{...(h?Object.fromEntries(h):{}),origin:base,'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await linkedinSequencesRequest(post(null,{action:'save'},'/api/linkedin/sequences'))).status,401);
 const got=await linkedinSequencesRequest(new Request(base+'/api/linkedin/sequences',{headers:s.headers}));assert.equal(got.status,200);assert.equal(got.headers.get('cache-control'),'no-store');
 assert.equal((await linkedinSequencesRequest(post(s.headers,{action:'save',input:{id:'x'}},'/api/linkedin/sequences'))).status,422);
 assert.equal((await linkedinTemplatesRequest(post(s.headers,{action:'nope'},'/api/linkedin/templates'))).status,422);
 const denied:string[]=[];
 for(const sql of ["SELECT app.claim_linkedin_sequence_step('t',now())",'SELECT body FROM app.linkedin_sequence_send'])
  denied.push(await withWorkspaceTransaction(s.p,c=>c.query(sql)).then(()=>'ok',(e:{code?:string})=>e.code!));
 assert.deepEqual(denied,['42501','42501']);
});
