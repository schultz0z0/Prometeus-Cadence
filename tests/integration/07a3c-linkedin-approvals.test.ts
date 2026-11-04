import test from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';
import{testAdmin}from'./prospecting-helpers.ts';
import{base}from'./helpers.ts';
import{withWorkspaceTransaction}from'../../src/server/db/transaction.ts';
import{saveLinkedinSequence,linkedinSequenceAction,runLinkedinSequenceTick}from'../../src/server/linkedin/sequences.ts';
import{listLinkedinApprovals,approveLinkedinComment,rejectLinkedinComment}from'../../src/server/linkedin/approvals.ts';
import{listLinkedinPeople,optOutLinkedinPerson,moveLinkedinPerson}from'../../src/server/linkedin/people.ts';
import{prepareLinkedinReply,confirmLinkedinReply}from'../../src/server/linkedin/conversations.ts';
import{linkedinApprovalsRequest,linkedinApprovalActionRequest}from'../../src/server/linkedin/http.ts';
import{useLinkedinTestEnv,user,code,FULL,setup,draft,activate,WED,rows,type Fake}from'./linkedin-helpers.ts';
import type{Principal}from'../../src/domain/workspace.ts';
useLinkedinTestEnv();
const CAPS={...FULL,readMessages:true,sendMessage:'automatic',profileActions:['comment']},NO_COMMENT={...FULL,readMessages:true,sendMessage:'automatic'};
const at=(min:number)=>new Date(WED+min*60e3).toISOString();
type Gen={calls:{post:string;guidance:string|null;name:string}[];reply:string|null};
function gen():Gen&{fn:(i:{postText:string;guidance:string|null;person:{name:string}})=>Promise<{text:string;usage:{provider:string}}|null>}{
 const g:Gen={calls:[],reply:'[RE] Ótimo ponto sobre logística no varejo.'};
 return Object.assign(g,{fn:async(i:{postText:string;guidance:string|null;person:{name:string}})=>{g.calls.push({post:i.postText,guidance:i.guidance,name:i.person.name});return g.reply===null?null:{text:g.reply,usage:{provider:'fake'}};}});
}
async function base0(caps:Record<string,unknown>=CAPS){const s=await setup(caps);const campaign=await activate(s.p,draft());return{...s,campaign};}
async function accepted(s:{p:Principal;u:Fake},campaign:string,n:number,withPost=true){
 const ids:{id:string;ext:string}[]=[];
 for(let i=0;i<n;i++){const id=randomUUID(),ext='ACoS'+randomUUID().slice(0,10);ids.push({id,ext});
  await testAdmin(c=>c.query("INSERT INTO app.linkedin_campaign_person(workspace_id,campaign_id,id,external_id,name,headline,company,state,invited_at,accepted_at) VALUES($1,$2,$3,$4,$5,'Diretor',$6,'accepted',$7,$7)",
   [s.p.workspaceId,campaign,id,ext,`[RE] Aceite ${i}`,`[RE] Empresa ${i}`,at(-60)]));
  if(withPost)s.u.posts.set(ext,[{social_id:'urn:li:activity:old'+i,text:'[RE] Post antigo',parsed_datetime:new Date(WED-40*864e5).toISOString(),share_url:'https://www.linkedin.com/posts/old'},
   {social_id:'urn:li:activity:new'+i,text:`[RE] Logística no varejo ${i}`,parsed_datetime:new Date(WED-864e5).toISOString(),share_url:'https://www.linkedin.com/posts/new'+i}]);}
 return ids;
}
const commentThenMessage=[{kind:'comment' as const,delayDays:0,guidance:'tom curioso'},{delayDays:1,body:'[RE] Oi, {nome}!'}];
async function start(p:Principal,campaignId:string,steps:unknown[]=commentThenMessage){
 const r=await saveLinkedinSequence(p,{id:randomUUID(),expectedRevision:0,sequence:{name:'[RE] Comentar e falar',campaignId,steps}});
 const a=await linkedinSequenceAction(p,r.id,'activate',{expectedRevision:r.revision});return{id:r.id,revision:a.revision};
}
const tick=(u:Fake,g:ReturnType<typeof gen>,min:number)=>runLinkedinSequenceTick({limit:10,now:new Date(WED+min*60e3)},{...u.deps,generateComment:g.fn});
const pending=async(p:Principal)=>(await listLinkedinApprovals(p,{tab:'pending'})).approvals;

test('07A.3c activation: a comment step needs the comment capability',async()=>{
 const s=await setup(NO_COMMENT);const campaign=await activate(s.p,draft());
 const r=await saveLinkedinSequence(s.p,{id:randomUUID(),expectedRevision:0,sequence:{name:'[RE] C',campaignId:campaign,steps:commentThenMessage}});
 assert.equal(await code(()=>linkedinSequenceAction(s.p,r.id,'activate',{expectedRevision:r.revision})),'409 LINKEDIN_UNAVAILABLE');
 const t=await base0();await start(t.p,t.campaign);
});

test('07A.3c the due step drafts an AI comment on the latest valid post and waits for approval',async()=>{
 const s=await base0(),g=gen();const [a]=await accepted(s,s.campaign,1);await start(s.p,s.campaign);
 await tick(s.u,g,0);
 assert.deepEqual(g.calls,[{post:'[RE] Logística no varejo 0',guidance:'tom curioso',name:'[RE] Aceite 0'}]);
 const [x]=await pending(s.p);
 assert.equal(x.person.id,a.id);assert.equal(x.body,'[RE] Ótimo ponto sobre logística no varejo.');assert.equal(x.post.text,'[RE] Logística no varejo 0');assert.equal(x.post.url,'https://www.linkedin.com/posts/new0');
 assert.equal(s.u.comments.length,0,'nothing public without approval');
 await tick(s.u,g,2*24*60);assert.equal(s.u.sent.length,0,'the next step waits for the approval');
 assert.equal(g.calls.length,1,'drafted once');
 // No AI route: the step is held, nothing is drafted.
 const t=await base0(),h=gen();h.reply=null;await accepted(t,t.campaign,1);await start(t.p,t.campaign);
 await tick(t.u,h,0);assert.equal((await pending(t.p)).length,0);
 assert.equal((await rows(t.p.workspaceId,'SELECT state FROM app.linkedin_sequence_run WHERE workspace_id=$1'))[0].state,'active');
});

test('07A.3c without a valid post the comment step is skipped and the sequence moves on',async()=>{
 const s=await base0(),g=gen();await accepted(s,s.campaign,1,false);await start(s.p,s.campaign);
 await tick(s.u,g,0);assert.equal(g.calls.length,0);assert.equal((await pending(s.p)).length,0);
 await tick(s.u,g,24*60+10);assert.deepEqual(s.u.sent.map(x=>x.text),['[RE] Oi, [RE] Aceite 0!']);
});

test('07A.3c approving publishes the reviewed text once; then the sequence continues',async()=>{
 const s=await base0(),g=gen();const [a]=await accepted(s,s.campaign,1);await start(s.p,s.campaign);
 await tick(s.u,g,0);const [x]=await pending(s.p);
 assert.equal(await code(()=>approveLinkedinComment(s.p,x.id,{body:'x',expectedRevision:x.revision+1,requestId:randomUUID()},s.u.deps)),'409 REVISION_CONFLICT');
 const req=randomUUID(),r=await approveLinkedinComment(s.p,x.id,{body:'[RE] Editado por mim.',expectedRevision:x.revision,requestId:req},s.u.deps);
 assert.equal(r.state,'posted');
 assert.deepEqual(s.u.comments.map(c=>[c.post,c.text,c.account]),[['urn:li:activity:new0','[RE] Editado por mim.',s.external]]);
 assert.deepEqual(await approveLinkedinComment(s.p,x.id,{body:'[RE] Editado por mim.',expectedRevision:x.revision,requestId:req},s.u.deps),r,'same request: same result');
 assert.equal(s.u.comments.length,1);
 assert.equal((await pending(s.p)).length,0);
 const [hist]=(await listLinkedinApprovals(s.p,{tab:'history'})).approvals;assert.equal(hist.state,'posted');assert.equal(hist.body,'[RE] Editado por mim.');
 await tick(s.u,g,24*60+10);assert.deepEqual(s.u.sent.map(x=>x.text),['[RE] Oi, [RE] Aceite 0!']);void a;
});

test('07A.3c approval rechecks opt-out; an uncertain comment is never repeated',async()=>{
 const s=await base0(),g=gen();const [a,b]=await accepted(s,s.campaign,2);await start(s.p,s.campaign);
 await tick(s.u,g,0);await tick(s.u,g,6);
 const list=await pending(s.p);assert.equal(list.length,2);
 const xa=list.find(x=>x.person.id===a.id)!,xb=list.find(x=>x.person.id===b.id)!;
 await optOutLinkedinPerson(s.p,a.id);
 assert.equal(await code(()=>approveLinkedinComment(s.p,xa.id,{body:xa.body,expectedRevision:xa.revision,requestId:randomUUID()},s.u.deps)),'409 LINKEDIN_OPTED_OUT');
 s.u.hooks.comment='timeout';
 assert.equal((await approveLinkedinComment(s.p,xb.id,{body:xb.body,expectedRevision:xb.revision,requestId:randomUUID()},s.u.deps)).state,'uncertain');
 s.u.hooks.comment=undefined;
 assert.match(await code(()=>approveLinkedinComment(s.p,xb.id,{body:xb.body,expectedRevision:xb.revision+1,requestId:randomUUID()},s.u.deps)),/^409/);
 assert.equal(s.u.comments.length,1,'only the uncertain attempt');
});

test('07A.3c reject skips the step; a pending approval expires in 7 days; a reply cancels it',async()=>{
 const s=await base0(),g=gen();const [a,b,c]=await accepted(s,s.campaign,3);await start(s.p,s.campaign);
 for(let i=0;i<3;i++)await tick(s.u,g,i*6);
 const list=await pending(s.p),of=(id:string)=>list.find(x=>x.person.id===id)!;
 await rejectLinkedinComment(s.p,of(a.id).id,{expectedRevision:of(a.id).revision});
 const me=(await listLinkedinPeople(s.p,{})).people.find(x=>x.id===b.id)!;
 await moveLinkedinPerson(s.p,{personId:b.id,stage:'replied',expectedRevision:me.stageRevision,requestId:randomUUID()});
 await tick(s.u,g,60);
 assert.deepEqual((await pending(s.p)).map(x=>x.person.id),[c.id],'the reply cancels its pending comment');
 await tick(s.u,g,8*24*60);
 assert.equal((await pending(s.p)).length,0,'expired');
 const states=(await listLinkedinApprovals(s.p,{tab:'history'})).approvals.map(x=>x.state).sort();
 assert.deepEqual(states,['cancelled','expired','rejected']);
 assert.equal(s.u.comments.length,0);
 // The next step counts its days from when the comment step closed: rejected now, expired on day 8.
 await tick(s.u,g,9*24*60+10);await tick(s.u,g,9*24*60+20);
 assert.deepEqual(s.u.sent.map(x=>x.text).sort(),['[RE] Oi, [RE] Aceite 0!','[RE] Oi, [RE] Aceite 2!'],'rejected and expired move on to the message; the one who replied stops');
});

test('07A.3c boundaries: workspaces, roles, HTTP and SQL',async()=>{
 const s=await base0(),g=gen();await accepted(s,s.campaign,1);await start(s.p,s.campaign);await tick(s.u,g,0);
 const [x]=await pending(s.p),other=await user();
 assert.equal((await listLinkedinApprovals(other.p,{tab:'pending'})).approvals.length,0);
 assert.equal(await code(()=>rejectLinkedinComment(other.p,x.id,{expectedRevision:x.revision})),'404 LINKEDIN_APPROVAL_NOT_FOUND');
 const post=(h:Headers|null,body:unknown,path:string)=>new Request(base+path,{method:'POST',headers:{...(h?Object.fromEntries(h):{}),origin:base,'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await linkedinApprovalsRequest(new Request(base+'/api/linkedin/approvals'))).status,401);
 const got=await linkedinApprovalsRequest(new Request(base+'/api/linkedin/approvals?tab=pending',{headers:s.headers}));assert.equal(got.status,200);assert.equal(got.headers.get('cache-control'),'no-store');
 assert.ok(!JSON.stringify(await got.json()).includes(s.external),'no vendor account id in the view');
 assert.equal((await linkedinApprovalActionRequest(post(s.headers,{body:''},'/api/linkedin/approvals/'+x.id+'/approve'),x.id,'approve')).status,422);
 assert.equal((await linkedinApprovalActionRequest(post(s.headers,{},'/api/linkedin/approvals/'+x.id+'/nope'),x.id,'nope')).status,404);
 const denied:string[]=[];
 for(const sql of ["SELECT app.finish_linkedin_sequence_comment('w','r','t',null,null,null,null,now())",'SELECT remote_comment_id FROM app.linkedin_approval'])
  denied.push(await withWorkspaceTransaction(s.p,c=>c.query(sql)).then(()=>'ok',(e:{code?:string})=>e.code!));
 assert.deepEqual(denied,['42501','42501']);
});

// Review findings (105a).
test('07A.3c review: approve refuses expired approvals and stopped sequences even before the worker sweeps',async()=>{
 const s=await base0(),g=gen();const [a,b,c]=await accepted(s,s.campaign,3);const sq=await start(s.p,s.campaign);
 for(let i=0;i<3;i++)await tick(s.u,g,i*6);
 const list=await pending(s.p),of=(id:string)=>list.find(x=>x.person.id===id)!;
 await testAdmin(q=>q.query("UPDATE app.linkedin_approval SET expires_at=clock_timestamp()-interval '1 minute' WHERE workspace_id=$1 AND person_id=$2",[s.p.workspaceId,a.id]));
 assert.equal(await code(()=>approveLinkedinComment(s.p,of(a.id).id,{body:'x',expectedRevision:of(a.id).revision,requestId:randomUUID()},s.u.deps)),'409 LINKEDIN_APPROVAL_CLOSED');
 const me=(await listLinkedinPeople(s.p,{})).people.find(x=>x.id===b.id)!;
 await moveLinkedinPerson(s.p,{personId:b.id,stage:'replied',expectedRevision:me.stageRevision,requestId:randomUUID()});
 assert.equal(await code(()=>approveLinkedinComment(s.p,of(b.id).id,{body:'x',expectedRevision:of(b.id).revision,requestId:randomUUID()},s.u.deps)),'409 LINKEDIN_APPROVAL_CLOSED');
 await linkedinSequenceAction(s.p,sq.id,'archive',{expectedRevision:sq.revision});
 assert.equal(await code(()=>approveLinkedinComment(s.p,of(c.id).id,{body:'x',expectedRevision:of(c.id).revision,requestId:randomUUID()},s.u.deps)),'409 LINKEDIN_APPROVAL_CLOSED');
 assert.equal(s.u.comments.length,0);
 assert.deepEqual((await pending(s.p)).map(x=>x.person.id).filter(x=>x===a.id),[],'an expired approval leaves the pending list');
});
test('07A.3c review: a manual reply does not skip a comment waiting for approval',async()=>{
 const s=await base0({...CAPS,sendMessage:'assisted'}),g=gen();const [a]=await accepted(s,s.campaign,1);await start(s.p,s.campaign);
 await tick(s.u,g,0);const [x]=await pending(s.p);
 const review=await prepareLinkedinReply(s.p,{personId:a.id,body:'[RE] Oi!'});
 await confirmLinkedinReply(s.p,{personId:a.id,body:'[RE] Oi!',token:review.token,requestId:randomUUID()},s.u.deps);
 assert.deepEqual((await rows(s.p.workspaceId,'SELECT state,step_index FROM app.linkedin_sequence_run WHERE workspace_id=$1')).map(r=>[r.state,r.step_index]),[['waiting',0]]);
 assert.equal((await pending(s.p))[0]?.id,x.id);
});
test('07A.3c review: an AI that keeps failing skips the comment step after three tries',async()=>{
 const s=await base0(),g=gen();g.reply=null;await accepted(s,s.campaign,1);await start(s.p,s.campaign);
 for(const m of [0,61,122])await tick(s.u,g,m);
 assert.equal(g.calls.length,3);assert.equal((await pending(s.p)).length,0);
 assert.deepEqual((await rows(s.p.workspaceId,'SELECT state,step_index FROM app.linkedin_sequence_run WHERE workspace_id=$1')).map(r=>[r.state,r.step_index]),[['active',1]]);
 await tick(s.u,g,183);assert.equal(g.calls.length,3,'not tried again');
});
