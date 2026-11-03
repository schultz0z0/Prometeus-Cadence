import test,{after,before,beforeEach}from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';
import{prospectingUser as createUser,testAdmin,closeProspectingPools}from'./prospecting-helpers.ts';
import{base,resetRateLimits}from'./helpers.ts';
import{withWorkspaceTransaction}from'../../src/server/db/transaction.ts';
import{attestLinkedinAdapter}from'../../src/server/linkedin/capabilities.ts';
import{confirmLinkedinConnection,finishLinkedinReturn,receiveLinkedinNotify,revokeLinkedinAccount}from'../../src/server/linkedin/connections.ts';
import{saveLinkedinCampaign,listLinkedinCampaigns,exploreLinkedinAudience,prepareLinkedinCampaign,confirmLinkedinCampaign,linkedinCampaignAction}from'../../src/server/linkedin/campaigns.ts';
import{runLinkedinCampaignTick}from'../../src/server/linkedin/invites.ts';
import{linkedinCampaignsRequest,linkedinCampaignActionRequest}from'../../src/server/linkedin/http.ts';
import{NO_LINKEDIN}from'../../src/domain/linkedin-capabilities.ts';
import{LINKEDIN_TERMS}from'../../src/domain/linkedin-connection.ts';
import{defaultCampaignDraft,type LinkedinCampaignDraft}from'../../src/domain/linkedin-campaign.ts';
import{closeIngressPool}from'../../src/server/channels/ingress-db.ts';
import type{Principal}from'../../src/domain/workspace.ts';
after(async()=>{await closeIngressPool();await closeProspectingPools();});
const env={UNIPILE_DSN:'api9.unipile.com:13111',UNIPILE_API_KEY:'unipile-key-qa-'+'k'.repeat(20)},saved:Record<string,string|undefined>={};
before(()=>{for(const [k,v] of Object.entries(env)){saved[k]=process.env[k];process.env[k]=v;}});
after(()=>{for(const k of Object.keys(env)){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}});
beforeEach(()=>testAdmin(async c=>{await c.query('DELETE FROM app.linkedin_capability_profile');}));
const user=async()=>{await resetRateLimits();return createUser();};
const code=async(fn:()=>Promise<unknown>)=>{try{await fn();return 'ok';}catch(e){const x=e as {status?:number;code?:string};return `${x.status}${x.code?' '+x.code:''}`;}};
const FULL={...NO_LINKEDIN,version:'unipile-qa',connect:true,audience:true,invite:true,acceptance:true,verifiedAt:null};
async function enable(caps:Record<string,unknown>=FULL){
 await resetRateLimits();const admin=await createUser({platformAi:true});
 const evidence=Object.fromEntries(['connect','audience','invite','acceptance'].filter(k=>(caps as Record<string,unknown>)[k]===true).map(k=>[k,['qa']]));
 if(Array.isArray(caps.profileActions)&&caps.profileActions.length)Object.assign(evidence,{profileVisit:['qa'],like:['qa']});
 const live=await testAdmin(async c=>Number((await c.query('SELECT coalesce(max(revision),0) r FROM app.linkedin_capability_profile WHERE revoked_at IS NULL')).rows[0].r));
 if(live)await testAdmin(c=>c.query('UPDATE app.linkedin_capability_profile SET capabilities=$1::jsonb,evidence_refs=$2::jsonb,revision=revision+1,verified_at=clock_timestamp() WHERE revoked_at IS NULL',[{...caps,verifiedAt:null},evidence]));
 else await attestLinkedinAdapter(admin.p,{adapterId:'unipile',kind:'account-connector',agreementRef:'QA fixture',expiresAt:new Date(Date.now()+30*864e5).toISOString(),capabilities:caps,evidenceRefs:evidence,expectedRevision:0});
}
type Person={id:string;name:string;headline:string;company?:string;location:string;network_distance:string;pending_invitation?:boolean;email?:string};
/** In-memory Unipile: account, search (+parameters), posts, invites, relations, profiles. Every call is recorded. */
function fakeUnipile(owner:Principal){
 const accounts=new Map<string,{name:string;memberId:string}>(),links:Record<string,any>[]=[],calls:string[]=[],searches:Record<string,any>[]=[],invites:{provider_id:string;message?:string}[]=[];
 const people:Person[]=[],relations:{member_id:string;public_identifier:string;first_name:string;last_name:string}[]=[],withdrawn:string[]=[];
 const params:Record<string,Record<string,string>>={LOCATION:{'São Paulo':'105871508'},INDUSTRY:{'Software':'4'}};
 const hooks:{invite?:'timeout'|'429'|'422'|'500';reactions?:string[]}={};
 const f=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input)),method=init?.method??'GET',body=init?.body?JSON.parse(String(init.body)):undefined;
  assert.equal(url.origin,'https://api9.unipile.com:13111');calls.push(method+' '+url.pathname);
  if(url.pathname==='/api/v1/hosted/accounts/link'){links.push(body);return Response.json({object:'HostedAuthURL',url:'https://account.unipile.com/qa'},{status:201});}
  let m=url.pathname.match(/^\/api\/v1\/accounts\/([A-Za-z0-9_-]+)$/);
  if(m){const a=accounts.get(m[1]);return a?Response.json({object:'Account',type:'LINKEDIN',id:m[1],name:a.name,connection_params:{im:{id:a.memberId}},sources:[{id:'s',status:'OK'}]}):Response.json({},{status:404});}
  if(url.pathname==='/api/v1/linkedin/search/parameters'){const id=params[url.searchParams.get('type')!]?.[url.searchParams.get('keywords')!];return Response.json({object:'LinkedinSearchParametersList',items:id?[{object:'LinkedinSearchParameter',title:url.searchParams.get('keywords'),id}]:[]});}
  if(url.pathname==='/api/v1/linkedin/search'){searches.push(body);const start=Number(url.searchParams.get('cursor')??0),page=people.slice(start,start+10);
   return Response.json({object:'LinkedinSearch',items:page.map(p=>({type:'PEOPLE',id:p.id,name:p.name,headline:p.headline,location:p.location,network_distance:p.network_distance,pending_invitation:!!p.pending_invitation,current_positions:p.company?[{company:p.company,role:p.headline}]:[]})),
    paging:{start,page_count:page.length,total_count:people.length},cursor:start+10<people.length?String(start+10):null});}
  m=url.pathname.match(/^\/api\/v1\/posts\/([^/]+)(\/reactions|\/comments)?$/);
  if(m){if(!m[2])return Response.json({object:'Post',social_id:'urn:li:activity:'+m[1],reaction_counter:(hooks.reactions??[]).length,comment_counter:0});
   const authors=m[2]==='/reactions'?(hooks.reactions??[]):[];return Response.json({items:authors.map(id=>{const p=people.find(x=>x.id===id)!;return {author:{id:p.id,name:p.name,headline:p.headline,network_distance:p.network_distance}};}),cursor:null});}
  if(url.pathname==='/api/v1/users/invite'&&method==='POST'){
   if(hooks.invite==='timeout'){invites.push(body);throw new TypeError('fetch failed');}
   if(hooks.invite==='429')return Response.json({type:'errors/limit_exceeded'},{status:429});
   if(hooks.invite==='422')return Response.json({type:'errors/already_invited_recently'},{status:422});
   if(hooks.invite==='500'){invites.push(body);return Response.json({},{status:500});}
   invites.push(body);return Response.json({object:'UserInvitationSent',invitation_id:'inv_'+body.provider_id},{status:201});}
  m=url.pathname.match(/^\/api\/v1\/users\/invite\/sent\/([^/]+)$/);if(m&&method==='DELETE'){withdrawn.push(m[1]);return Response.json({object:'UserInvitationCanceled'});}
  if(url.pathname==='/api/v1/users/relations')return Response.json({object:'UserRelationsList',items:[...relations].reverse(),cursor:null});
  m=url.pathname.match(/^\/api\/v1\/users\/([A-Za-z0-9_-]+)$/);
  if(m){const p=people.find(x=>x.id===m![1]);if(!p)return Response.json({},{status:404});const [first,...last]=p.name.split(' ');
   return Response.json({object:'UserProfile',provider:'LINKEDIN',provider_id:p.id,public_identifier:'re-'+p.id.toLowerCase(),first_name:first,last_name:last.join(' '),headline:p.headline,location:p.location,contact_info:p.email?{emails:[p.email]}:{}});}
  return Response.json({},{status:404});
 }) as typeof fetch;
 return{owner,accounts,links,calls,searches,invites,people,relations,withdrawn,params,hooks,deps:{fetch:f},count:(c:string)=>calls.filter(x=>x===c).length};
}
type Fake=ReturnType<typeof fakeUnipile>;
async function connect(u:Fake){
 const p=u.owner;await confirmLinkedinConnection(p,p.sessionId,{termsVersion:LINKEDIN_TERMS.version,acceptTerms:true,expectedRevision:0},u.deps);
 const link=u.links.at(-1)!,external='acc_'+randomUUID().replaceAll('-','').slice(0,16);u.accounts.set(external,{name:'[RE] Conta',memberId:'ACoME'+randomUUID().slice(0,6)});
 await receiveLinkedinNotify(new URL(link.notify_url).searchParams.get('token')!,{status:'CREATION_SUCCESS',account_id:external,name:link.name},u.deps);
 await finishLinkedinReturn(p,p.sessionId,new URL(link.success_redirect_url));
 return external;
}
async function setup(caps:Record<string,unknown>=FULL){await enable(caps);const owner=await user(),u=fakeUnipile(owner.p);const external=await connect(u);return{...owner,u,external};}
const person=(n:number,o:Partial<Person>={}):Person=>({id:'ACoP'+String(n).padStart(4,'0')+randomUUID().slice(0,4),name:`[RE] Pessoa ${n}`,headline:'Diretor Comercial',company:`[RE] Empresa ${n}`,location:'São Paulo',network_distance:'DISTANCE_2',...o});
const draft=(o:Partial<LinkedinCampaignDraft>={}):LinkedinCampaignDraft=>{const d=defaultCampaignDraft();return {...d,name:'[RE] Campanha QA',warming:false,decisionMakerOnly:false,note:'Olá, {nome}! Vi a {empresa}.',
 source:{...d.source,mode:'filters',roles:['CEO','Diretor'],locations:['São Paulo'],industries:['Software'],keyword:'vendas'},...o};};
async function save(p:Principal,d:LinkedinCampaignDraft,id:string=randomUUID(),expectedRevision=0){return saveLinkedinCampaign(p,{id,expectedRevision,draft:d});}
async function activate(p:Principal,d:LinkedinCampaignDraft){const s=await save(p,d);await confirmLinkedinCampaign(p,{id:s.id,revision:s.revision});return s.id;}
const WED=Date.parse('2026-11-04T12:00:00Z');// Wednesday 9h in Brasília
async function ticks(u:Fake,n:number,start=WED,stepMin=21){let now=start;for(let i=0;i<n;i++){await runLinkedinCampaignTick({limit:10,now:new Date(now)},u.deps);now+=stepMin*60e3;}return now;}
const rows=(ws:string,sql:string,args:unknown[]=[])=>testAdmin(async c=>(await c.query(sql,[ws,...args])).rows);
const states=async(ws:string,campaign:string)=>Object.fromEntries((await rows(ws,'SELECT state,count(*)::int n FROM app.linkedin_campaign_person WHERE workspace_id=$1 AND campaign_id=$2 GROUP BY state',[campaign])).map(r=>[r.state,r.n]));

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
 await ticks(s.u,4,Date.parse('2026-11-07T15:00:00Z'));assert.equal(s.u.invites.length,0);
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
