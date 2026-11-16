import type {SdrDraft} from './sdr-policy.ts';
import {timezoneLabel} from './sdr-stage.ts';
// 16/11/2026: meeting reminders of the Agente SDR — when they go out and the app-written text (no AI).
export type SdrReminderKind='day-before'|'two-hours';
type Hours=SdrDraft['hours'];
const HOUR=3600000;
/** Wall clock of an instant in a timezone. */
function local(ms:number,tz:string){
 const f=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms)).map(x=>[x.type,x.value]));
 const y=+f.year,m=+f.month,d=+f.day;
 return {y,m,d,time:`${f.hour}:${f.minute}`,weekday:new Date(Date.UTC(y,m-1,d)).getUTCDay()};
}
/** The instant of a wall-clock date and time in a timezone. */
function instant(y:number,m:number,d:number,time:string,tz:string){
 const [h,mi]=time.split(':').map(Number),guess=Date.UTC(y,m-1,d,h,mi);
 let t=guess;
 for(let i=0;i<2;i++){const l=local(t,tz),[lh,lm]=l.time.split(':').map(Number);t+=guess-Date.UTC(l.y,l.m-1,l.d,lh,lm);}
 return t;
}
const open=(h:Hours,weekday:number,time:string)=>h.weekdays.includes(weekday)&&(h.allDay||(time>=h.start&&time<h.end));
/** 0–2 reminder times: the day before at 09:00 (or the agent's opening, if later) and 2h before, each inside the agent's hours and at least 1h after booking. */
export function sdrReminderTimes(i:{start:string;bookedAt:string;hours:Hours}):{kind:SdrReminderKind;at:string}[]{
 const start=Date.parse(i.start),earliest=Date.parse(i.bookedAt)+HOUR,tz=i.hours.timezone,out:{kind:SdrReminderKind;at:string}[]=[];
 const s=local(start,tz),eve=new Date(Date.UTC(s.y,s.m-1,s.d-1)),ey=eve.getUTCFullYear(),em=eve.getUTCMonth()+1,ed=eve.getUTCDate();
 const time=!i.hours.allDay&&i.hours.start>'09:00'?i.hours.start:'09:00',dayBefore=instant(ey,em,ed,time,tz);
 if(open(i.hours,eve.getUTCDay(),time)&&dayBefore>=earliest)out.push({kind:'day-before',at:new Date(dayBefore).toISOString()});
 const two=start-2*HOUR,t=local(two,tz);
 if(open(i.hours,t.weekday,t.time)&&two>=earliest)out.push({kind:'two-hours',at:new Date(two).toISOString()});
 return out;
}
export function firstName(name:string|null):string|null{
 const n=(name??'').trim();
 return !n||/^[+\d\s()-]+$/.test(n)?null:n.split(/\s+/)[0];
}
export function sdrReminderText(i:{kind:SdrReminderKind;name:string|null;start:string;timezone:string;meetUrl:string|null;confirmed:boolean}):string{
 const n=firstName(i.name),hi=n?`Oi, ${n}!`:'Oi!',ms=Date.parse(i.start),l=local(ms,i.timezone),tz=timezoneLabel(i.timezone);
 if(i.kind==='day-before'){
  const weekday=new Intl.DateTimeFormat('pt-BR',{timeZone:i.timezone,weekday:'long'}).format(new Date(ms)).replace(/-feira$/,'');
  return `${hi} Passando para confirmar nossa reunião amanhã, ${weekday}, ${String(l.d).padStart(2,'0')}/${String(l.m).padStart(2,'0')}, às ${l.time} (${tz}), pelo Google Meet. Segue de pé? Se precisar, te ofereço outro horário.`;
 }
 const link=i.meetUrl?` O link do Google Meet é ${i.meetUrl} e também está no convite do seu e-mail.`:'';
 return `${hi} Nossa reunião é hoje às ${l.time} (${tz}).${link} ${i.confirmed?'Te espero lá!':'Segue de pé?'}`;
}
