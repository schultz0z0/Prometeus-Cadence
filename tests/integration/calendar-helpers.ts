import assert from 'node:assert/strict';
import{CALENDAR_SCOPES,type CalendarDeps}from'../../src/server/integrations/calendar.ts';
/** In-memory Google Agenda: token endpoint, free/busy, and create/get/delete of events by id. */
export function fakeCalendar(){
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
