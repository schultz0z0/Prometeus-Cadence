import test,{after,before}from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';
import{prospectingUser as createUser,testAdmin,closeProspectingPools}from'./prospecting-helpers.ts';
import{base,resetRateLimits}from'./helpers.ts';
import{executeWorkspaceCommand,readWorkspaceSnapshot}from'../../src/server/workspaces/commands.ts';
import{listConnections}from'../../src/server/integrations/connections.ts';
import{startCalendarAuthorization,finishCalendarAuthorization,configureCalendar,readCalendarSlots,reserveCalendarSlot,cancelCalendarReservation,CALENDAR_SCOPES,type CalendarDeps}from'../../src/server/integrations/calendar.ts';
import{integrationsRequest,integrationItemRequest}from'../../src/server/integrations/http.ts';
import type{Principal}from'../../src/domain/workspace.ts';
after(closeProspectingPools);
const callback=base+'/api/integration-oauth/google-calendar/callback',env={GOOGLE_CALENDAR_CLIENT_ID:'client-qa',GOOGLE_CALENDAR_CLIENT_SECRET:'secret-qa',GOOGLE_CALENDAR_REDIRECT_URI:callback};
const saved:Record<string,string|undefined>={};
before(()=>{for(const [k,v] of Object.entries(env)){saved[k]=process.env[k];process.env[k]=v;}});
after(()=>{for(const k of Object.keys(env)){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}});
const user=async()=>{await resetRateLimits();return createUser();};

/** In-memory Google Agenda: token endpoint, free/busy, and create/get/delete of events by id. */
function fakeCalendar(){
 const events=new Map<string,{start:string;end:string;status:string;summary:string}>(),calls:string[]=[];let n=0;
 const hooks:{busy:{start:string;end:string}[];scope?:string;afterCreate?:()=>Promise<unknown>|void;beforeFreeBusy?:()=>Response|undefined;lagGet?:number}={busy:[]};
 const fakeFetch:typeof fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input)),method=init?.method??'GET',body=init?.body?String(init.body):'';
  if(url.host==='oauth2.googleapis.com')return Response.json({access_token:'access-qa-'+(++n),token_type:'Bearer',expires_in:3600,scope:hooks.scope??CALENDAR_SCOPES.join(' '),refresh_token:'refresh-qa-'+'r'.repeat(12)});
  assert.equal(url.host,'www.googleapis.com');assert.match(String((init?.headers as Record<string,string>).authorization),/^Bearer access-qa-/);
  calls.push(method+' '+url.pathname.replace('/calendar/v3',''));
  if(url.pathname==='/calendar/v3/freeBusy'){const forced=hooks.beforeFreeBusy?.();if(forced)return forced;
   const b=JSON.parse(body),own=[...events.values()].filter(e=>e.status!=='cancelled').map(e=>({start:e.start,end:e.end}));
   return Response.json({calendars:{[b.items[0].id]:{busy:[...hooks.busy,...own].filter(x=>x.start<b.timeMax&&x.end>b.timeMin)}}});}
  const m=url.pathname.match(/^\/calendar\/v3\/calendars\/primary\/events(?:\/([a-v0-9]+))?$/);if(!m)return Response.json({error:{message:'not found'}},{status:404});
  if(method==='POST'){assert.equal(url.searchParams.get('sendUpdates'),'none');const b=JSON.parse(body);
   if(events.has(b.id))return Response.json({error:{code:409,message:'The requested identifier already exists.'}},{status:409});
   events.set(b.id,{start:b.start.dateTime,end:b.end.dateTime,status:'confirmed',summary:b.summary});await hooks.afterCreate?.();return Response.json({id:b.id,status:'confirmed'});}
  const e=events.get(m[1]);
  if(method==='GET'&&hooks.lagGet){hooks.lagGet--;return Response.json({error:{message:'Not Found'}},{status:404});}
  if(method==='GET')return e?Response.json({id:m[1],status:e.status}):Response.json({error:{message:'Not Found'}},{status:404});
  if(method==='DELETE'){if(!e)return Response.json({error:{message:'Not Found'}},{status:404});if(e.status==='cancelled')return Response.json({error:{message:'Resource has been deleted'}},{status:410});e.status='cancelled';return new Response(null,{status:204});}
  return Response.json({},{status:405});
 }) as typeof fetch;
 return{events,calls,hooks,deps:{fetch:fakeFetch} as CalendarDeps,count:(c:string)=>calls.filter(x=>x===c).length};
}
async function authorize(p:Principal,g:ReturnType<typeof fakeCalendar>){
 const u=new URL((await startCalendarAuthorization(p,p.sessionId)).authorizationUrl);
 return finishCalendarAuthorization(p,p.sessionId,new URL(callback+'?state='+u.searchParams.get('state')+'&code=code-qa'),g.deps);
}
const rules=(f:Record<string,unknown>={})=>({timezone:'America/Sao_Paulo',weekdays:[0,1,2,3,4,5,6],start:'00:00',end:'23:30',durationMinutes:30,noticeHours:0,horizonDays:3,expectedRevision:0,...f});
const calendar=async(p:Principal)=>(await listConnections(p)).connections.find(c=>c.kind==='google-calendar')!;
async function ready(){const u=await user(),g=fakeCalendar();await authorize(u.p,g);await configureCalendar(u.p,rules(),g.deps);
 const s=await readWorkspaceSnapshot(u.p);await executeWorkspaceCommand(u.p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'leads.import',dedupScope:'list',list:{id:'base',name:'Base QA'},
  leads:[{id:'m1',listId:'base',name:'[RE] Contato Agenda',companyName:'[RE] Empresa',email:'m1@example.com',qualification:'pending',source:'MANUAL',createdAt:new Date().toISOString()}]}});
 return{...u,g};}
// Tomorrow at noon in Brasília: a fixed time of day, so the 23:30 cut-off and slot alignment never depend on when the suite runs.
const window=()=>{const t=new Date(Date.now()+86400000);const from=Date.UTC(t.getUTCFullYear(),t.getUTCMonth(),t.getUTCDate(),15);return{from:new Date(from).toISOString(),to:new Date(from+6*3600000).toISOString()};};
const reservation=(ws:string,id:string)=>testAdmin(async c=>(await c.query('SELECT state,revision,last_error FROM app.calendar_reservation WHERE workspace_id=$1 AND id=$2',[ws,id])).rows[0]);

test('connect asks both calendar scopes; a missing one connects nothing; configuring is admin-only and proves access; operators read slots without the busy ones',async()=>{
 const u=await user(),g=fakeCalendar();
 const url=new URL((await startCalendarAuthorization(u.p,u.p.sessionId)).authorizationUrl);
 assert.deepEqual(url.searchParams.get('scope')!.split(' '),CALENDAR_SCOPES);assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 g.hooks.scope=CALENDAR_SCOPES[0];
 await assert.rejects(finishCalendarAuthorization(u.p,u.p.sessionId,new URL(callback+'?state='+url.searchParams.get('state')+'&code=c'),g.deps),{status:422,code:'CALENDAR_SCOPE_DENIED'});
 assert.equal((await listConnections(u.p)).connections.some(c=>c.kind==='google-calendar'),false);
 g.hooks.scope=undefined;await authorize(u.p,g);
 const live=await calendar(u.p);assert.equal(live.state,'setup');assert.equal(live.calendar,null);assert.equal(JSON.stringify(live).includes('refresh-qa'),false);assert.equal(JSON.stringify(live).includes('access-qa'),false);
 // An operator cannot configure, and nothing reaches Google.
 const op={...(await user()).p,workspaceId:u.p.workspaceId};
 await testAdmin(c=>c.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',[randomUUID(),op.workspaceId,op.userId,'operator']));
 await assert.rejects(configureCalendar(op,rules(),g.deps),{status:403});assert.equal(g.calls.length,0);
 await assert.rejects(configureCalendar(u.p,rules({end:'08:00',start:'09:00'}),g.deps),{status:422});
 await assert.rejects(readCalendarSlots(u.p,{},g.deps),{status:409,code:'CALENDAR_SETUP'});
 await configureCalendar(u.p,rules(),g.deps);assert.equal(g.count('POST /freeBusy'),1);
 await assert.rejects(configureCalendar(u.p,rules(),g.deps),{status:409});
 const w=window(),busyStart=new Date(Date.parse(w.from)+3600000);busyStart.setUTCMinutes(0,0,0);
 g.hooks.busy=[{start:busyStart.toISOString(),end:new Date(busyStart.getTime()+3600000).toISOString()}];
 const {slots,timezone}=await readCalendarSlots(op,w,g.deps);assert.equal(timezone,'America/Sao_Paulo');
 assert.ok(slots.length>=9&&slots.every(s=>s.available&&s.id.length>40));
 assert.equal(slots.some(s=>Date.parse(s.start)>=busyStart.getTime()&&Date.parse(s.start)<busyStart.getTime()+3600000),false,'busy hour removed');
 await assert.rejects(readCalendarSlots(u.p,{from:w.from,to:new Date(Date.parse(w.from)+15*86400000).toISOString()},g.deps),{status:422});
});

test('two reservations of one slot: one event and one conflict; repeating the request returns the same reservation; the slot leaves the list',async()=>{
 const {p,g}=await ready(),[slot]=(await readCalendarSlots(p,window(),g.deps)).slots;
 const results=await Promise.allSettled([reserveCalendarSlot(p,{slotId:slot.id,leadId:'m1',requestId:randomUUID()},g.deps),reserveCalendarSlot(p,{slotId:slot.id,leadId:'m1',requestId:randomUUID()},g.deps)]);
 const ok=results.filter(r=>r.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof reserveCalendarSlot>>>[],no=results.filter(r=>r.status==='rejected') as PromiseRejectedResult[];
 assert.equal(ok.length,1);assert.equal(no.length,1);assert.equal(no[0].reason.status,409);assert.equal(g.events.size,1);
 const v=ok[0].value;assert.equal(v.state,'accepted');assert.equal(v.start,slot.start);assert.ok(v.externalId);
 assert.match([...g.events.values()][0].summary,/\[RE\] Contato Agenda · \[RE\] Empresa/);
 // Same request again: no second event, same answer.
 const requestId=randomUUID(),next=(await readCalendarSlots(p,window(),g.deps)).slots;
 assert.equal(next.some(s=>s.start===slot.start),false);
 const a=await reserveCalendarSlot(p,{slotId:next[0].id,leadId:'m1',requestId},g.deps),b=await reserveCalendarSlot(p,{slotId:next[0].id,leadId:'m1',requestId},g.deps);
 assert.deepEqual(b,a);assert.equal(g.count('POST /calendars/primary/events'),2);assert.equal(g.events.size,2);
 await assert.rejects(reserveCalendarSlot(p,{slotId:next[1].id,leadId:'m1',requestId},g.deps),{status:409,code:'REQUEST_REUSED'});
 await assert.rejects(reserveCalendarSlot(p,{slotId:next[1].id,leadId:'nobody',requestId:randomUUID()},g.deps),{status:404});
});

test('a lost answer leaves the reservation uncertain; the repeat finds the event by its id instead of booking twice',async()=>{
 const {p,g}=await ready(),[slot]=(await readCalendarSlots(p,window(),g.deps)).slots,requestId=randomUUID();
 const real=g.deps.fetch!;let drop=true;
 const deps:CalendarDeps={fetch:(async(i:RequestInfo|URL,init?:RequestInit)=>{const r=await real(i,init);if(drop&&init?.method==='POST'&&String(i).includes('/events')){drop=false;throw new TypeError('socket hang up');}return r;}) as typeof fetch};
 await assert.rejects(reserveCalendarSlot(p,{slotId:slot.id,leadId:'m1',requestId},deps),{status:503});
 const row=(await testAdmin(async c=>(await c.query('SELECT id,state FROM app.calendar_reservation WHERE workspace_id=$1',[p.workspaceId])).rows[0]));
 assert.equal(row.state,'uncertain');assert.equal(g.events.size,1);
 // While uncertain, the slot stays held locally.
 assert.equal((await readCalendarSlots(p,window(),g.deps)).slots.some(s=>s.start===slot.start),false);
 const v=await reserveCalendarSlot(p,{slotId:slot.id,leadId:'m1',requestId},g.deps);
 assert.equal(v.state,'accepted');assert.equal(v.id,row.id);assert.equal(g.events.size,1);assert.equal(g.count('POST /calendars/primary/events'),1);
});

test('cancel twice deletes once; an uncertain reservation with no event is cancelled after asking Google; stale revision is refused',async()=>{
 const {p,g}=await ready(),slots=(await readCalendarSlots(p,window(),g.deps)).slots;
 const v=await reserveCalendarSlot(p,{slotId:slots[0].id,leadId:'m1',requestId:randomUUID()},g.deps);
 await assert.rejects(cancelCalendarReservation(p,v.id,{expectedRevision:v.revision+1},g.deps),{status:409});
 const c1=await cancelCalendarReservation(p,v.id,{expectedRevision:v.revision},g.deps),c2=await cancelCalendarReservation(p,v.id,{expectedRevision:v.revision},g.deps);
 assert.equal(c1.state,'cancelled');assert.deepEqual(c2,c1);assert.equal(g.count('DELETE /calendars/primary/events/'+v.externalId),1);
 assert.equal([...g.events.values()][0].status,'cancelled');
 // The freed slot is offered again.
 assert.ok((await readCalendarSlots(p,window(),g.deps)).slots.some(s=>s.start===slots[0].start));
 // Timeout before Google created anything: uncertain, then cancel asks Google (404) and settles.
 const real=g.deps.fetch!;const deps:CalendarDeps={fetch:(async(i:RequestInfo|URL,init?:RequestInit)=>{if(init?.method==='POST'&&String(i).includes('/events'))throw new TypeError('timeout');return real(i,init);}) as typeof fetch};
 await assert.rejects(reserveCalendarSlot(p,{slotId:slots[1].id,leadId:'m1',requestId:randomUUID()},deps),{status:503});
 const u=(await testAdmin(async c=>(await c.query("SELECT id,revision FROM app.calendar_reservation WHERE workspace_id=$1 AND state='uncertain'",[p.workspaceId])).rows[0]));
 const c3=await cancelCalendarReservation(p,u.id,{expectedRevision:Number(u.revision)},g.deps);assert.equal(c3.state,'cancelled');assert.equal(g.events.size,1);
});

test('slot ids are sealed to the workspace, the configuration and five minutes; a slot taken in Google meanwhile is refused without an event',async()=>{
 const {p,g}=await ready(),other=await ready(),w=window();
 const [s1,s2]=(await readCalendarSlots(p,w,g.deps)).slots;
 await assert.rejects(reserveCalendarSlot(other.p,{slotId:s1.id,leadId:'m1',requestId:randomUUID()},other.g.deps),{status:422,code:'SLOT_INVALID'});
 await assert.rejects(reserveCalendarSlot(p,{slotId:s1.id.slice(0,-4)+'AAAA',leadId:'m1',requestId:randomUUID()},g.deps),{status:422});
 const [old]=(await readCalendarSlots(p,w,{...g.deps,now:()=>Date.now()-301000})).slots;
 await assert.rejects(reserveCalendarSlot(p,{slotId:old.id,leadId:'m1',requestId:randomUUID()},g.deps),{status:409,code:'SLOT_EXPIRED'});
 // Taken in Google between reading and reserving: the re-read refuses it and nothing is created.
 g.hooks.busy=[{start:s2.start,end:s2.end}];
 await assert.rejects(reserveCalendarSlot(p,{slotId:s2.id,leadId:'m1',requestId:randomUUID()},g.deps),{status:409,code:'SLOT_TAKEN'});
 assert.equal(g.events.size,0);g.hooks.busy=[];
 // Reconfigured after reading: old ids no longer reserve.
 await configureCalendar(p,rules({durationMinutes:60,expectedRevision:(await calendar(p)).configRevision}),g.deps);
 await assert.rejects(reserveCalendarSlot(p,{slotId:s1.id,leadId:'m1',requestId:randomUUID()},g.deps),{status:409,code:'CONNECTION_CHANGED'});
});

test('HTTP contract: authorize and validation through the API; a refused grant marks the connection for reconnect; no client configured is 503',async()=>{
 const u=await ready(),{p,g}=u;
 const post=(body:unknown)=>integrationsRequest(new Request(base+'/api/integrations',{method:'POST',headers:u.headers,body:JSON.stringify(body)}));
 const r=await post({action:'calendar-authorize'});assert.equal(r.status,200);assert.match((await r.json()).authorizationUrl,/^https:\/\/accounts\.google\.com\//);
 assert.equal((await post({action:'calendar-reserve',input:{slotId:'x',leadId:'m1',requestId:randomUUID()}})).status,422);
 assert.equal((await post({action:'calendar-slots',input:{from:'yesterday'}})).status,422);
 assert.equal((await integrationItemRequest(new Request(base+'/api/integrations/x/calendar-cancel',{method:'POST',headers:u.headers,body:JSON.stringify({expectedRevision:1})}),'x','calendar-cancel')).status,422);
 g.hooks.beforeFreeBusy=()=>Response.json({error:{code:401,status:'UNAUTHENTICATED'}},{status:401});
 await assert.rejects(readCalendarSlots(p,window(),g.deps),{status:409,code:'CALENDAR_RECONNECT'});
 assert.equal((await calendar(p)).attention,'reconnect');
 await assert.rejects(readCalendarSlots(p,window(),g.deps),{status:409,code:'CALENDAR_ATTENTION'});
 delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
 try{assert.equal((await post({action:'calendar-authorize'})).status,503);}finally{process.env.GOOGLE_CALENDAR_CLIENT_ID=env.GOOGLE_CALENDAR_CLIENT_ID;}
});

test('review: a repeat while the first attempt is in flight waits; a repeat whose lookup lags still settles as booked, not as taken by its own event',async()=>{
 const {p,g}=await ready(),[s1,s2]=(await readCalendarSlots(p,window(),g.deps)).slots,requestId=randomUUID();
 let replay:Promise<unknown>|undefined;
 g.hooks.afterCreate=()=>{g.hooks.afterCreate=undefined;replay=reserveCalendarSlot(p,{slotId:s1.id,leadId:'m1',requestId},g.deps).then(()=>'ok',e=>e);return replay;};
 assert.equal((await reserveCalendarSlot(p,{slotId:s1.id,leadId:'m1',requestId},g.deps)).state,'accepted');
 const second=await replay as {status?:number;code?:string};assert.equal(second.status,409);assert.equal(second.code,'RESERVATION_PENDING');
 assert.equal(g.count('POST /calendars/primary/events'),1);
 // Lost answer, then Google's lookup lags behind free/busy: the repeat must not call its own event a conflict.
 const req2=randomUUID(),real=g.deps.fetch!;let drop=true;
 const lossy:CalendarDeps={fetch:(async(i:RequestInfo|URL,init?:RequestInit)=>{const res=await real(i,init);if(drop&&init?.method==='POST'&&String(i).includes('/events')){drop=false;throw new TypeError('reset');}return res;}) as typeof fetch};
 await assert.rejects(reserveCalendarSlot(p,{slotId:s2.id,leadId:'m1',requestId:req2},lossy),{status:503});
 g.hooks.lagGet=1;
 const v=await reserveCalendarSlot(p,{slotId:s2.id,leadId:'m1',requestId:req2},g.deps);
 assert.equal(v.state,'accepted');assert.equal(g.events.size,2);
});

test('review: reconnecting clears a lost-calendar attention so slots come back; a deleted lead does not hide a stored reservation',async()=>{
 const {p,g}=await ready();
 const [slot]=(await readCalendarSlots(p,window(),g.deps)).slots,requestId=randomUUID();
 const v=await reserveCalendarSlot(p,{slotId:slot.id,leadId:'m1',requestId},g.deps);
 g.hooks.beforeFreeBusy=()=>Response.json({calendars:{primary:{errors:[{domain:'global',reason:'notFound'}]}}});
 await assert.rejects(readCalendarSlots(p,window(),g.deps),{status:422,code:'CALENDAR_MISSING'});
 assert.equal((await calendar(p)).attention,'missing');
 g.hooks.beforeFreeBusy=undefined;await authorize(p,g);
 assert.equal((await calendar(p)).attention,null);
 assert.ok((await readCalendarSlots(p,window(),g.deps)).slots.length>0);
 await testAdmin(c=>c.query("DELETE FROM app.lead WHERE workspace_id=$1 AND id='m1'",[p.workspaceId]));
 assert.deepEqual(await reserveCalendarSlot(p,{slotId:slot.id,leadId:'m1',requestId},g.deps),v);
});
