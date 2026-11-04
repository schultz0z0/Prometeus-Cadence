import{after,before,beforeEach}from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';
import{prospectingUser as createUser,testAdmin,closeProspectingPools}from'./prospecting-helpers.ts';
import{resetRateLimits}from'./helpers.ts';
import{attestLinkedinAdapter}from'../../src/server/linkedin/capabilities.ts';
import{confirmLinkedinConnection,finishLinkedinReturn,receiveLinkedinNotify}from'../../src/server/linkedin/connections.ts';
import{saveLinkedinCampaign,confirmLinkedinCampaign}from'../../src/server/linkedin/campaigns.ts';
import{runLinkedinCampaignTick}from'../../src/server/linkedin/invites.ts';
import{NO_LINKEDIN}from'../../src/domain/linkedin-capabilities.ts';
import{LINKEDIN_TERMS}from'../../src/domain/linkedin-connection.ts';
import{defaultCampaignDraft,type LinkedinCampaignDraft}from'../../src/domain/linkedin-campaign.ts';
import{closeIngressPool}from'../../src/server/channels/ingress-db.ts';
import type{Principal}from'../../src/domain/workspace.ts';
// Shared by the LinkedIn integration suites (07A.2, 07A.3): an in-memory Unipile and the setup through the real services.
export const env={UNIPILE_DSN:'api9.unipile.com:13111',UNIPILE_API_KEY:'unipile-key-qa-'+'k'.repeat(20)},saved:Record<string,string|undefined>={};
/** Registers the Unipile env, pool shutdown and a clean platform gate for the calling test file. */
export function useLinkedinTestEnv(){
 before(()=>{for(const [k,v] of Object.entries(env)){saved[k]=process.env[k];process.env[k]=v;}});
 after(()=>{for(const k of Object.keys(env)){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}});
 after(async()=>{await closeIngressPool();await closeProspectingPools();});
 beforeEach(()=>testAdmin(async c=>{await c.query('DELETE FROM app.linkedin_capability_profile');}));
}
export const user=async()=>{await resetRateLimits();return createUser();};
export const code=async(fn:()=>Promise<unknown>)=>{try{await fn();return 'ok';}catch(e){const x=e as {status?:number;code?:string};return `${x.status}${x.code?' '+x.code:''}`;}};
export const FULL={...NO_LINKEDIN,version:'unipile-qa',connect:true,audience:true,invite:true,acceptance:true,verifiedAt:null};
export async function enable(caps:Record<string,unknown>=FULL){
 await resetRateLimits();const admin=await createUser({platformAi:true});
 const evidence=Object.fromEntries(['connect','audience','invite','acceptance'].filter(k=>(caps as Record<string,unknown>)[k]===true).map(k=>[k,['qa']]));
 if(Array.isArray(caps.profileActions)&&caps.profileActions.length)Object.assign(evidence,{profileVisit:['qa'],like:['qa']});
 if(caps.readMessages===true)Object.assign(evidence,{readMessages:['qa']});
 if(caps.sendMessage&&caps.sendMessage!=='unavailable')Object.assign(evidence,{sendMessage:['qa']});
 const live=await testAdmin(async c=>Number((await c.query('SELECT coalesce(max(revision),0) r FROM app.linkedin_capability_profile WHERE revoked_at IS NULL')).rows[0].r));
 if(live)await testAdmin(c=>c.query('UPDATE app.linkedin_capability_profile SET capabilities=$1::jsonb,evidence_refs=$2::jsonb,revision=revision+1,verified_at=clock_timestamp() WHERE revoked_at IS NULL',[{...caps,verifiedAt:null},evidence]));
 else await attestLinkedinAdapter(admin.p,{adapterId:'unipile',kind:'account-connector',agreementRef:'QA fixture',expiresAt:new Date(Date.now()+30*864e5).toISOString(),capabilities:caps,evidenceRefs:evidence,expectedRevision:0});
}
export type Person={id:string;name:string;headline:string;company?:string;location:string;network_distance:string;pending_invitation?:boolean;email?:string};
/** In-memory Unipile: account, search (+parameters), posts, invites, relations, profiles. Every call is recorded. */
export function fakeUnipile(owner:Principal){
 const accounts=new Map<string,{name:string;memberId:string}>(),links:Record<string,any>[]=[],calls:string[]=[],searches:Record<string,any>[]=[],invites:{provider_id:string;message?:string}[]=[];
 const people:Person[]=[],relations:{member_id:string;public_identifier:string;first_name:string;last_name:string}[]=[],withdrawn:string[]=[];
 const params:Record<string,Record<string,string>>={LOCATION:{'São Paulo':'105871508'},INDUSTRY:{'Software':'4'}};
 // A partial match: the provider answers with a different title; it must be refused, never used silently.
 const loose:Record<string,{title:string;id:string}>={'Varejo':{title:'Venda a varejo de alimentos',id:'9'}};
 const hooks:{invite?:'timeout'|'429'|'422'|'500';reactions?:string[];goneInvites?:Set<string>;send?:'timeout'}={};
 const chats=new Map<string,{attendee:string;messages:{id:string;text:string;timestamp:string;is_sender:0|1;sender_id:string}[]}>(),sent:{chat:string;text:string}[]=[];let seq=0;
 const f=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input)),method=init?.method??'GET',body=init?.body instanceof FormData?Object.fromEntries(init.body):init?.body?JSON.parse(String(init.body)):undefined;
  assert.equal(url.origin,'https://api9.unipile.com:13111');calls.push(method+' '+url.pathname);
  if(url.pathname==='/api/v1/hosted/accounts/link'){links.push(body);return Response.json({object:'HostedAuthURL',url:'https://account.unipile.com/qa'},{status:201});}
  let m=url.pathname.match(/^\/api\/v1\/accounts\/([A-Za-z0-9_-]+)$/);
  if(m){const a=accounts.get(m[1]);return a?Response.json({object:'Account',type:'LINKEDIN',id:m[1],name:a.name,connection_params:{im:{id:a.memberId}},sources:[{id:'s',status:'OK'}]}):Response.json({},{status:404});}
  if(url.pathname==='/api/v1/linkedin/search/parameters'){const k=url.searchParams.get('keywords')!,id=params[url.searchParams.get('type')!]?.[k];return Response.json({object:'LinkedinSearchParametersList',items:id?[{object:'LinkedinSearchParameter',title:k,id}]:loose[k]?[loose[k]]:[]});}
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
  m=url.pathname.match(/^\/api\/v1\/users\/invite\/sent\/([^/]+)$/);if(m&&method==='DELETE'){if(hooks.goneInvites?.has(m[1]))return Response.json({},{status:404});withdrawn.push(m[1]);return Response.json({object:'UserInvitationCanceled'});}
  if(url.pathname==='/api/v1/users/relations')return Response.json({object:'UserRelationsList',items:[...relations].reverse(),cursor:null});
  m=url.pathname.match(/^\/api\/v1\/users\/([A-Za-z0-9_-]+)$/);
  if(m){const p=people.find(x=>x.id===m![1]);if(!p)return Response.json({},{status:404});const [first,...last]=p.name.split(' ');
   return Response.json({object:'UserProfile',provider:'LINKEDIN',provider_id:p.id,public_identifier:'re-'+p.id.toLowerCase(),first_name:first,last_name:last.join(' '),headline:p.headline,location:p.location,contact_info:p.email?{emails:[p.email]}:{},network_distance:p.network_distance});}
  if(url.pathname==='/api/v1/messages'){const after=Date.parse(url.searchParams.get('after')??'1970-01-01');
   const all=[...chats].flatMap(([chat_id,c])=>c.messages.map(m=>({object:'Message',chat_id,provider_id:'li-'+m.id,...m}))).filter(m=>Date.parse(m.timestamp)>after).sort((a,b)=>b.timestamp.localeCompare(a.timestamp)||b.id.localeCompare(a.id));
   const start=Number(url.searchParams.get('cursor')??0),limit=Number(url.searchParams.get('limit')??100);
   return Response.json({object:'MessageList',items:all.slice(start,start+limit),cursor:start+limit<all.length?String(start+limit):null});}
  m=url.pathname.match(/^\/api\/v1\/chats\/([A-Za-z0-9_-]+)(\/messages)?$/);
  if(m){const c=chats.get(m[1]);if(!c)return Response.json({},{status:404});
   if(!m[2])return Response.json({object:'Chat',id:m[1],attendee_provider_id:c.attendee});
   if(method==='POST'){if(hooks.send==='timeout'){sent.push({chat:m[1],text:String(body.text)});throw new TypeError('fetch failed');}
    const id='msg_out_'+(++seq);sent.push({chat:m[1],text:String(body.text)});c.messages.push({id,text:String(body.text),timestamp:new Date().toISOString(),is_sender:1,sender_id:'ME'});
    return Response.json({object:'MessageSent',message_id:id},{status:201});}}
  return Response.json({},{status:404});
 }) as typeof fetch;
 return{owner,accounts,links,calls,searches,invites,people,relations,withdrawn,params,hooks,chats,sent,deps:{fetch:f},count:(c:string)=>calls.filter(x=>x===c).length};
}
export type Fake=ReturnType<typeof fakeUnipile>;
export async function connect(u:Fake,memberId='ACoME'+randomUUID().slice(0,6)){
 const p=u.owner;await confirmLinkedinConnection(p,p.sessionId,{termsVersion:LINKEDIN_TERMS.version,acceptTerms:true,expectedRevision:0},u.deps);
 const link=u.links.at(-1)!,external='acc_'+randomUUID().replaceAll('-','').slice(0,16);u.accounts.set(external,{name:'[RE] Conta',memberId});
 await receiveLinkedinNotify(new URL(link.notify_url).searchParams.get('token')!,{status:'CREATION_SUCCESS',account_id:external,name:link.name},u.deps);
 await finishLinkedinReturn(p,p.sessionId,new URL(link.success_redirect_url));
 return external;
}
export async function setup(caps:Record<string,unknown>=FULL){await enable(caps);const owner=await user(),u=fakeUnipile(owner.p),memberId='ACoME'+randomUUID().slice(0,6);const external=await connect(u,memberId);return{...owner,u,external,memberId};}
export const person=(n:number,o:Partial<Person>={}):Person=>({id:'ACoP'+String(n).padStart(4,'0')+randomUUID().slice(0,4),name:`[RE] Pessoa ${n}`,headline:'Diretor Comercial',company:`[RE] Empresa ${n}`,location:'São Paulo',network_distance:'DISTANCE_2',...o});
export const draft=(o:Partial<LinkedinCampaignDraft>={}):LinkedinCampaignDraft=>{const d=defaultCampaignDraft();return {...d,name:'[RE] Campanha QA',warming:false,decisionMakerOnly:false,note:'Olá, {nome}! Vi a {empresa}.',
 source:{...d.source,mode:'filters',roles:['CEO','Diretor'],locations:['São Paulo'],industries:['Software'],keyword:'vendas'},...o};};
export async function save(p:Principal,d:LinkedinCampaignDraft,id:string=randomUUID(),expectedRevision=0){return saveLinkedinCampaign(p,{id,expectedRevision,draft:d});}
export async function activate(p:Principal,d:LinkedinCampaignDraft){const s=await save(p,d);await confirmLinkedinCampaign(p,{id:s.id,revision:s.revision});return s.id;}
export const WED=Date.parse('2026-11-04T12:00:00Z');// Wednesday 9h in Brasília
export async function ticks(u:Fake,n:number,start=WED,stepMin=21){let now=start;for(let i=0;i<n;i++){await runLinkedinCampaignTick({limit:10,now:new Date(now)},u.deps);now+=stepMin*60e3;}return now;}
export const rows=(ws:string,sql:string,args:unknown[]=[])=>testAdmin(async c=>(await c.query(sql,[ws,...args])).rows);
export const states=async(ws:string,campaign:string)=>Object.fromEntries((await rows(ws,'SELECT state,count(*)::int n FROM app.linkedin_campaign_person WHERE workspace_id=$1 AND campaign_id=$2 GROUP BY state',[campaign])).map(r=>[r.state,r.n]));
