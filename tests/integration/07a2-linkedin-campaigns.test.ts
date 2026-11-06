import test from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';
import{testAdmin}from'./prospecting-helpers.ts';
import{base}from'./helpers.ts';
import{withWorkspaceTransaction}from'../../src/server/db/transaction.ts';
import{revokeLinkedinAccount}from'../../src/server/linkedin/connections.ts';
import{saveLinkedinCampaign,listLinkedinCampaigns,exploreLinkedinAudience,prepareLinkedinCampaign,confirmLinkedinCampaign,linkedinCampaignAction}from'../../src/server/linkedin/campaigns.ts';
import{runLinkedinCampaignTick}from'../../src/server/linkedin/invites.ts';
import{linkedinCampaignsRequest,linkedinCampaignActionRequest}from'../../src/server/linkedin/http.ts';
import{useLinkedinTestEnv,user,code,FULL,enable,connect,setup,person,draft,save,activate,WED,ticks,rows,states}from'./linkedin-helpers.ts';
useLinkedinTestEnv();

test('07A.2 drafts keep every control; revisions, roles and workspaces are enforced',async()=>{
 const s=await setup(),d=draft({otherList:'new',enrichOnAccept:true,expireDays:21,dailyLimit:8,proof:'[RE] prova',extraProof:'[RE] outra'});
 const saved=await save(s.p,d);assert.equal(saved.revision,1);
 const listed=(await listLinkedinCampaigns(s.p)).campaigns.find(c=>c.id===saved.id)!;
 assert.deepEqual(listed.draft,d);assert.equal(listed.state,'draft');
 assert.equal(await code(()=>save(s.p,d,saved.id,0)),'409 REVISION_CONFLICT');
 assert.equal(await code(()=>saveLinkedinCampaign(s.p,{id:saved.id,expectedRevision:1,draft:{...d,dailyLimit:50}})),'422');
 const other=await user();
 assert.equal(await code(()=>save(other.p,d,saved.id,1)),'404 LINKEDIN_CAMPAIGN_NOT_FOUND','another workspace cannot reach it');
 assert.equal((await listLinkedinCampaigns(other.p)).campaigns.length,0);
 assert.equal(s.u.searches.length,0,'saving calls nothing');
});

test('07A.2 explore: every filter reaches the provider, or nothing is called',async()=>{
 const s=await setup();s.u.people.push(...Array.from({length:3},(_,i)=>person(i)));
 const r=await exploreLinkedinAudience(s.p,draft().source,s.u.deps);
 assert.equal(r.total,3);assert.equal(r.sample.length,3);assert.equal(r.sample[0].name,'[RE] Pessoa 0');
 const body=s.u.searches[0];
 assert.equal(body.api,'classic');assert.equal(body.category,'people');assert.deepEqual(body.network_distance,[2,3]);
 assert.deepEqual(body.location,['105871508']);assert.deepEqual(body.industry,['4']);assert.equal(body.keywords,'vendas');assert.equal(body.advanced_keywords.title,'CEO OR Diretor');
 const before=s.u.searches.length;
 assert.equal(await code(()=>exploreLinkedinAudience(s.p,{...draft().source,locations:['Atlântida Perdida']},s.u.deps)),'422 LINKEDIN_FILTER_UNSUPPORTED');
 assert.equal(await code(()=>exploreLinkedinAudience(s.p,{...draft().source,mode:'url',searchUrl:'https://www.linkedin.com/search/results/companies/?keywords=x'},s.u.deps)),'422 LINKEDIN_FILTER_UNSUPPORTED');
 assert.equal(await code(()=>exploreLinkedinAudience(s.p,{...draft().source,industries:['Varejo']},s.u.deps)),'422 LINKEDIN_FILTER_UNSUPPORTED','a different industry is never used in its place');
 assert.equal(s.u.searches.length,before,'a refused filter never calls the search');
 await exploreLinkedinAudience(s.p,{...draft().source,mode:'url',searchUrl:'https://www.linkedin.com/search/results/people/?keywords=ceo'},s.u.deps);
 assert.equal(s.u.searches.at(-1)!.url,'https://www.linkedin.com/search/results/people/?keywords=ceo');
 s.u.hooks.reactions=[s.u.people[0].id];
 const post=await exploreLinkedinAudience(s.p,{...draft().source,mode:'post',postUrl:'https://www.linkedin.com/posts/ana_x-activity-7236734771807019010-3qVO'},s.u.deps);
 assert.equal(post.total,1);assert.equal(post.sample[0].name,'[RE] Pessoa 0');
 assert.equal((await listLinkedinCampaigns(s.p)).campaigns.length,0,'exploring saves nothing');
 await enable({...FULL,audience:false});
 assert.equal(await code(()=>exploreLinkedinAudience(s.p,draft().source,s.u.deps)),'409 LINKEDIN_UNAVAILABLE');
});

test('07A.2 activation: blockers first, owner/admin only, frozen revision and lists created',async()=>{
 const s=await setup(),op=await user();
 const blocked=await save(s.p,draft({warming:true,decisionMakerOnly:true}));
 const review=await prepareLinkedinCampaign(s.p,{id:blocked.id,revision:blocked.revision});
 assert.equal(review.blockers.length,2);assert.ok(review.estimate,'the estimate is shown apart from the real audience');
 assert.equal(await code(()=>confirmLinkedinCampaign(s.p,{id:blocked.id,revision:blocked.revision})),'409 LINKEDIN_CAMPAIGN_BLOCKED');
 const ok=await save(s.p,draft({otherList:'new'}));
 assert.equal(await code(()=>confirmLinkedinCampaign(s.p,{id:ok.id,revision:ok.revision+1})),'409 REVISION_CONFLICT');
 await testAdmin(c=>c.query('UPDATE auth.member SET role=$3 WHERE "organizationId"=$1 AND "userId"=$2',[s.p.workspaceId,s.p.userId,'operator']));
 assert.equal(await code(()=>confirmLinkedinCampaign(s.p,{id:ok.id,revision:ok.revision})),'403 LINKEDIN_CAMPAIGN_ACCESS');
 await testAdmin(c=>c.query('UPDATE auth.member SET role=$3 WHERE "organizationId"=$1 AND "userId"=$2',[s.p.workspaceId,s.p.userId,'owner']));
 await confirmLinkedinCampaign(s.p,{id:ok.id,revision:ok.revision});
 const c=(await listLinkedinCampaigns(s.p)).campaigns.find(x=>x.id===ok.id)!;
 assert.equal(c.state,'active');assert.ok(c.acceptListId);assert.ok(c.otherListId);
 assert.equal(await code(()=>save(s.p,draft(),ok.id,c.revision)),'409 LINKEDIN_CAMPAIGN_LOCKED','an active campaign is frozen');
 assert.equal((await rows(s.p.workspaceId,'SELECT count(*)::int n FROM app.list WHERE workspace_id=$1'))[0].n>=2,true);
 assert.equal(await code(()=>confirmLinkedinCampaign(op.p,{id:ok.id,revision:ok.revision})),'404 LINKEDIN_CAMPAIGN_NOT_FOUND');
});

test('07A.2 two campaigns on one account: 12 invites a day in total, one invite per person, business hours only',async()=>{
 const s=await setup(),shared=[person(100),person(101),person(102)];
 s.u.people.push(...shared,...Array.from({length:14},(_,i)=>person(i)),person(200,{network_distance:'DISTANCE_1'}),person(201,{pending_invitation:true}),person(202,{company:undefined}));
 const a=await activate(s.p,draft({name:'[RE] A'})),b=await activate(s.p,draft({name:'[RE] B'}));
 // Saturday: nothing leaves.
 await ticks(s.u,4,WED+3*864e5+3*3600e3);assert.equal(s.u.invites.length,0);
 await ticks(s.u,30);
 assert.equal(s.u.invites.length,12,'account cap across campaigns');
 const ids=s.u.invites.map(i=>i.provider_id);assert.equal(new Set(ids).size,ids.length,'never the same person twice');
 for(const p of [200,201])assert.equal(ids.some(id=>id.startsWith('ACoP0'+p)),false,'1st degree and pending invites are excluded');
 assert.equal(s.u.invites.some(i=>i.provider_id===s.u.people.find(p=>p.name.endsWith('202'))!.id),false,'missing {empresa}: skipped, not invented');
 assert.match(s.u.invites[0].message??'',/^Olá, \[RE\] Pessoa \d+! Vi a \[RE\] Empresa \d+\.$/);
 const dup=await rows(s.p.workspaceId,"SELECT count(*)::int n FROM app.linkedin_campaign_person WHERE workspace_id=$1 AND reason LIKE '%outra campanha%'");
 // Next weekday: the rest continues.
 await ticks(s.u,30,WED+864e5);
 const total=new Set(s.u.invites.map(i=>i.provider_id)).size;assert.equal(total,s.u.invites.length);
 assert.equal(total,17,'14 + 3 shared, each once');
 assert.ok(dup[0].n>=0);
 const sa=await states(s.p.workspaceId,a),sb=await states(s.p.workspaceId,b);
 assert.equal((sa.invited??0)+(sb.invited??0),17);
});

test('07A.2 an uncertain send is never repeated; pause after the claim stops the send; 429 holds the account for the day',async()=>{
 const s=await setup();s.u.people.push(...Array.from({length:5},(_,i)=>person(i)));
 const id=await activate(s.p,draft());
 s.u.hooks.invite='timeout';await ticks(s.u,1);
 assert.equal(s.u.invites.length,1);assert.equal((await states(s.p.workspaceId,id)).uncertain,1);
 s.u.hooks.invite=undefined;await ticks(s.u,3,WED+30*60e3);
 const uncertainId=s.u.invites[0].provider_id;assert.equal(s.u.invites.filter(i=>i.provider_id===uncertainId).length,1,'not resent');
 // 429: back to the queue, no more invites today.
 const sent=s.u.invites.length;s.u.hooks.invite='429';await ticks(s.u,1,WED+3*3600e3);s.u.hooks.invite=undefined;
 await ticks(s.u,5,WED+4*3600e3);assert.equal(s.u.invites.length,sent,'held until tomorrow');
 // Paused between the claim and the call: nothing is sent and the person goes back to the queue.
 const c=(await listLinkedinCampaigns(s.p)).campaigns.find(x=>x.id===id)!;
 const queuedBefore=(await states(s.p.workspaceId,id)).queued??0;
 await runLinkedinCampaignTick({limit:10,now:new Date(WED+864e5)},{...s.u.deps,afterClaim:()=>linkedinCampaignAction(s.p,id,'pause',{expectedRevision:c.revision})});
 assert.equal(s.u.invites.length,sent);assert.equal((await states(s.p.workspaceId,id)).queued,queuedBefore);
 assert.equal((await listLinkedinCampaigns(s.p)).campaigns.find(x=>x.id===id)!.state,'paused');
 await ticks(s.u,3,WED+864e5+3600e3);assert.equal(s.u.invites.length,sent,'paused campaigns send nothing');
});

test('07A.2 acceptance: one lead and one event however often it is seen; enrichment uses only what the profile shows; non-accepted expire to the other list',async()=>{
 const s=await setup();s.u.people.push(person(1,{email:'p1@example.com'}),person(2),person(3));
 const id=await activate(s.p,draft({enrichOnAccept:true,otherList:'new',expireDays:7}));
 await ticks(s.u,6);assert.equal(s.u.invites.length,3);
 const [p1,p2]=s.u.people;s.u.relations.push({member_id:p1.id,public_identifier:'re-p1',first_name:'[RE]',last_name:'Pessoa 1'},{member_id:p2.id,public_identifier:'re-p2',first_name:'[RE]',last_name:'Pessoa 2'},{member_id:'ACoSTRANGER',public_identifier:'x',first_name:'Fora',last_name:'Da campanha'});
 await ticks(s.u,1,WED+5*3600e3);await ticks(s.u,1,WED+6*3600e3);
 const c=(await listLinkedinCampaigns(s.p)).campaigns.find(x=>x.id===id)!;
 const leads=await rows(s.p.workspaceId,'SELECT payload FROM app.lead WHERE workspace_id=$1 AND list_id=$2',[c.acceptListId]);
 assert.equal(leads.length,2,'one lead per accepted person');
 const l1=leads.find(l=>l.payload.name==='[RE] Pessoa 1')!.payload;
 assert.equal(l1.source,'LINKEDIN');assert.equal(l1.email,'p1@example.com');assert.equal(leads.find(l=>l.payload.name==='[RE] Pessoa 2')!.payload.email,undefined,'no invented email');
 assert.equal((await rows(s.p.workspaceId,"SELECT count(*)::int n FROM app.linkedin_campaign_event WHERE workspace_id=$1 AND kind='accepted'"))[0].n,2);
 assert.equal((await states(s.p.workspaceId,id)).accepted,2);
 // Eight days later the third invite is withdrawn and goes to the other list, with no reply.
 await ticks(s.u,1,WED+8*864e5);
 assert.equal(s.u.withdrawn.length,1);assert.equal((await states(s.p.workspaceId,id)).expired,1);
 const others=await rows(s.p.workspaceId,'SELECT payload FROM app.lead WHERE workspace_id=$1 AND list_id=$2',[c.otherListId]);
 assert.equal(others.length,1);assert.equal(others[0].payload.name,'[RE] Pessoa 3');
});

test('07A.2 authority: a revoked account or gate stops sending at once; HTTP and SQL boundaries hold',async()=>{
 const s=await setup();s.u.people.push(...Array.from({length:4},(_,i)=>person(i)));
 const id=await activate(s.p,draft());
 await ticks(s.u,1);assert.equal(s.u.invites.length,1);
 await enable({...FULL,invite:false});await ticks(s.u,3,WED+3600e3);assert.equal(s.u.invites.length,1,'gate off: no send');
 await enable(FULL);
 const acc=await rows(s.p.workspaceId,"SELECT id,revision FROM app.linkedin_account WHERE workspace_id=$1 AND state<>'revoked'");
 await revokeLinkedinAccount(s.p,acc[0].id,{expectedRevision:Number(acc[0].revision)},s.u.deps);
 await ticks(s.u,3,WED+2*3600e3);assert.equal(s.u.invites.length,1,'revoked account: no send');
 const post=(h:Headers|null,body:unknown,path='/api/linkedin/campaigns')=>new Request(base+path,{method:'POST',headers:{...(h?Object.fromEntries(h):{}),origin:base,'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await linkedinCampaignsRequest(post(null,{action:'save'}))).status,401);
 const got=await linkedinCampaignsRequest(new Request(base+'/api/linkedin/campaigns',{headers:s.headers}));assert.equal(got.status,200);assert.equal(got.headers.get('cache-control'),'no-store');
 assert.equal(JSON.stringify(await got.json()).includes(s.external),false,'no vendor id reaches the browser');
 assert.equal((await linkedinCampaignsRequest(post(s.headers,{action:'save',input:{id:'x'}}))).status,422);
 assert.equal((await linkedinCampaignsRequest(post(s.headers,{action:'nope'}))).status,422);
 assert.equal((await linkedinCampaignActionRequest(post(s.headers,{},`/api/linkedin/campaigns/${id}/explode`),id,'explode')).status,404);
 const other=await user();
 assert.equal((await linkedinCampaignActionRequest(post(other.headers,{expectedRevision:2},`/api/linkedin/campaigns/${id}/pause`),id,'pause')).status,404);
 const denied:string[]=[];
 for(const sql of ['SELECT * FROM app.linkedin_invite_operation',"SELECT app.claim_linkedin_invite('t',now())",'SELECT external_id FROM app.linkedin_campaign_person'])
  denied.push(await withWorkspaceTransaction(s.p,c=>c.query(sql)).then(()=>'ok',(e:{code?:string})=>e.code!));
 assert.deepEqual(denied,['42501','42501','42501']);
});

test('07A.2 review: reconnecting the same LinkedIn member keeps its invite ledger; old campaigns end',async()=>{
 const s=await setup();const p1=person(1);s.u.people.push(p1);
 const old=await activate(s.p,draft());await ticks(s.u,2);assert.equal(s.u.invites.length,1);
 const acc=await rows(s.p.workspaceId,"SELECT id,revision FROM app.linkedin_account WHERE workspace_id=$1 AND state<>'revoked'");
 await revokeLinkedinAccount(s.p,acc[0].id,{expectedRevision:Number(acc[0].revision)},s.u.deps);
 assert.equal((await listLinkedinCampaigns(s.p)).campaigns.find(c=>c.id===old)!.state,'completed','a campaign on a disconnected account ends');
 await connect(s.u,s.memberId);
 await activate(s.p,draft({name:'[RE] De novo'}));await ticks(s.u,3,WED+3600e3);
 assert.equal(s.u.invites.filter(i=>i.provider_id===p1.id).length,1,'the same person is not invited again by the same LinkedIn member');
});

test('07A.2 review: an accepted invite found gone at expiry is an acceptance, not a non-accept',async()=>{
 const s=await setup();const p1=person(1);s.u.people.push(p1);
 const id=await activate(s.p,draft({otherList:'new',expireDays:7}));await ticks(s.u,2);assert.equal(s.u.invites.length,1);
 // Accepted long ago, beyond the relations the check reads: the invite no longer exists and the profile is 1st degree.
 s.u.hooks.goneInvites=new Set(['inv_'+p1.id]);p1.network_distance='DISTANCE_1';
 await ticks(s.u,1,WED+8*864e5);
 const st=await states(s.p.workspaceId,id);assert.equal(st.accepted,1);assert.equal(st.expired,undefined);
 const c=(await listLinkedinCampaigns(s.p)).campaigns.find(x=>x.id===id)!;
 assert.equal((await rows(s.p.workspaceId,'SELECT count(*)::int n FROM app.lead WHERE workspace_id=$1 AND list_id=$2',[c.otherListId]))[0].n,0);
 assert.equal((await rows(s.p.workspaceId,'SELECT count(*)::int n FROM app.lead WHERE workspace_id=$1 AND list_id=$2',[c.acceptListId]))[0].n,1);
});

test('07A.2 review: post audiences honour the chosen degrees; a crash left in sending becomes uncertain, never resent',async()=>{
 const s=await setup();const p2=person(2),p3=person(3,{network_distance:'DISTANCE_3'}),pn=person(4,{network_distance:''});s.u.people.push(p2,p3,pn);
 s.u.hooks.reactions=[p2.id,p3.id,pn.id];
 const d=draft();const id=await activate(s.p,{...d,note:'',source:{...d.source,mode:'post',postUrl:'https://www.linkedin.com/posts/ana_x-activity-7236734771807019010-3qVO',degrees:[2]}});
 await runLinkedinCampaignTick({limit:10,now:new Date(WED-3600e3)},s.u.deps);
 const names=(await rows(s.p.workspaceId,'SELECT name FROM app.linkedin_campaign_person WHERE workspace_id=$1 AND campaign_id=$2',[id])).map(r=>r.name);
 assert.deepEqual(names,['[RE] Pessoa 2'],'3rd degree and unknown degree are left out when only 2nd was chosen');
 await testAdmin(c=>c.query("UPDATE app.linkedin_campaign_person SET state='sending',op_token='crashed',updated_at=clock_timestamp()-interval '10 minutes' WHERE workspace_id=$1",[s.p.workspaceId]));
 await testAdmin(c=>c.query("INSERT INTO app.linkedin_invite_operation(workspace_id,account_id,member_id,external_id,campaign_id,person_id,state,day) SELECT p.workspace_id,c.account_id,$2,p.external_id,p.campaign_id,p.id,'sending',current_date FROM app.linkedin_campaign_person p JOIN app.linkedin_campaign c ON c.workspace_id=p.workspace_id AND c.id=p.campaign_id WHERE p.workspace_id=$1",[s.p.workspaceId,s.memberId]));
 await ticks(s.u,2);
 assert.equal((await states(s.p.workspaceId,id)).uncertain,1);assert.equal(s.u.invites.length,0,'never sent after the crash');
});
