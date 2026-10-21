import {z} from 'zod';
import type {Schedule} from './model.ts';
export interface ScheduleV2 extends Schedule{anchorDate:string;monthDay?:number;intervalDays?:number}
export interface DueWindow{scheduledAt:string;nextRunAt:string|null;skipped:number}
const DAY=86400000,MINUTE=60000;
const formatters=new Map<string,Intl.DateTimeFormat>();
function formatter(timezone:string){let f=formatters.get(timezone);if(!f){f=new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});formatters.set(timezone,f);}return f;}
function wallParts(time:number,timezone:string){const p=Object.fromEntries(formatter(timezone).formatToParts(new Date(time)).map(p=>[p.type,p.value]));return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`,epoch:Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second))};}
function validDate(date:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<'1970-01-01')return false;const value=Date.parse(date+'T00:00:00Z');return Number.isFinite(value)&&new Date(value).toISOString().slice(0,10)===date;}
function validZone(zone:string){try{formatter(zone);return true;}catch{return false;}}
const dateSchema=z.string().refine(validDate),timeSchema=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const scheduleV2Schema=z.strictObject({frequency:z.enum(['once','daily','weekly','biweekly','monthly','custom']),time:timeSchema,timezone:z.string().min(1).max(100).refine(validZone),weekdays:z.array(z.number().int().min(0).max(6)).max(7).refine(v=>new Set(v).size===v.length),anchorDate:dateSchema,monthDay:z.number().int().min(1).max(31).optional(),intervalDays:z.number().int().min(1).max(365).optional()}).superRefine((s,c)=>{
 if(['daily','weekly'].includes(s.frequency)&&!s.weekdays.length)c.addIssue({code:'custom',message:'Selecione os dias da semana.'});
 if(s.frequency==='monthly'&&s.monthDay===undefined)c.addIssue({code:'custom',message:'Informe o dia do mês.'});
 if(s.frequency==='custom'&&s.intervalDays===undefined)c.addIssue({code:'custom',message:'Informe o intervalo em dias.'});
});
function instant(value:string){const time=Date.parse(value);if(!Number.isFinite(time))throw Error('Instante inválido.');return time;}
export function localDateAt(iso:string,timezone:string){return wallParts(instant(iso),timezone).date;}
export function wallTimeToUtc(date:string,time:string,timezone:string):string{
 if(!validDate(date)||!timeSchema.safeParse(time).success||!validZone(timezone))throw Error('Data, horário ou fuso inválido.');
 const target=Date.parse(date+'T'+time+':00Z'),offsets=new Set<number>();
 for(let hours=-36;hours<=36;hours+=6){const at=target+hours*3600000;offsets.add(wallParts(at,timezone).epoch-at);}
 const candidates=[...offsets].map(offset=>target-offset).sort((a,b)=>a-b);
 const exact=candidates.filter(at=>wallParts(at,timezone).epoch===target);
 if(exact.length)return new Date(exact[0]).toISOString();
 // A forward local gap has no exact candidate. Find its first valid minute.
 let lo=Math.floor(candidates[0]/MINUTE),hi=Math.ceil(candidates.at(-1)!/MINUTE);
 if(wallParts(hi*MINUTE,timezone).epoch<target)throw Error('Não foi possível resolver a transição de fuso.');
 while(lo<hi){const mid=Math.floor((lo+hi)/2);if(wallParts(mid*MINUTE,timezone).epoch>=target)hi=mid;else lo=mid+1;}
 return new Date(lo*MINUTE).toISOString();
}
const day=(date:string)=>Date.parse(date+'T00:00:00Z')/DAY;
const dayDate=(n:number)=>new Date(n*DAY).toISOString().slice(0,10);
const month=(date:string)=>Number(date.slice(0,4))*12+Number(date.slice(5,7))-1;
function monthDay(m:number,wanted:number){const year=Math.floor(m/12),mon=m%12;if(year>9999||year<1970)return null;const last=new Date(Date.UTC(year,mon+1,0)).getUTCDate();return Date.UTC(year,mon,Math.min(wanted,last))/DAY;}
function nextDate(s:ScheduleV2,from:number,direction:1|-1):number|null{
 const anchor=day(s.anchorDate);if(direction<0&&from<anchor)return null;if(direction>0)from=Math.max(from,anchor);
 if(s.frequency==='once')return direction===1?anchor>=from?anchor:null:anchor<=from?anchor:null;
 if(s.frequency==='daily'||s.frequency==='weekly'){
  for(let i=0;i<7;i++){const candidate=from+i*direction;if(candidate<anchor)return null;if(s.weekdays.includes(((candidate+4)%7+7)%7))return candidate;}return null;
 }
 if(s.frequency==='biweekly'||s.frequency==='custom'){
  const interval=s.frequency==='biweekly'?14:s.intervalDays!,n=direction===1?Math.max(0,Math.ceil((from-anchor)/interval)):Math.floor((from-anchor)/interval);return n<0?null:anchor+n*interval;
 }
 let m=month(dayDate(from));
 for(let i=0;i<3;i++,m+=direction){const candidate=monthDay(m,s.monthDay!);if(candidate===null)return null;if(candidate>=anchor&&(direction===1?candidate>=from:candidate<=from))return candidate;}
 return null;
}
function occurrence(s:ScheduleV2,at:string,direction:1|-1):string|null{
 const time=instant(at);let from=day(localDateAt(at,s.timezone));
 for(let i=0;i<3;i++){
  const candidate=nextDate(s,from,direction);if(candidate===null)return null;
  const date=dayDate(candidate);if(!validDate(date))return null;
  const utc=wallTimeToUtc(date,s.time,s.timezone),value=instant(utc);
  if(direction===1?value>time:value<=time)return utc;
  from=candidate+direction;
 }
 return null;
}
export function nextOccurrence(schedule:ScheduleV2,afterIso:string):string|null{return occurrence(scheduleV2Schema.parse(schedule),afterIso,1);}
function countDates(s:ScheduleV2,from:number,to:number){
 if(to<from)return 0;
 if(s.frequency==='once')return 1;
 if(s.frequency==='monthly')return month(dayDate(to))-month(dayDate(from))+1;
 if(s.frequency==='biweekly'||s.frequency==='custom')return Math.floor((to-from)/(s.frequency==='biweekly'?14:s.intervalDays!))+1;
 const length=to-from+1,weeks=Math.floor(length/7);let count=weeks*s.weekdays.length;
 for(let i=0;i<length%7;i++)if(s.weekdays.includes(((from+weeks*7+i+4)%7+7)%7))count++;
 return count;
}
export function latestDueWindow(schedule:ScheduleV2,storedNextIso:string,nowIso:string):DueWindow|null{
 const s=scheduleV2Schema.parse(schedule),first=instant(storedNextIso),now=instant(nowIso);if(first>now)return null;
 const scheduledAt=occurrence(s,nowIso,-1);if(!scheduledAt||instant(scheduledAt)<first)return null;
 const from=day(localDateAt(storedNextIso,s.timezone)),to=day(localDateAt(scheduledAt,s.timezone));
 return {scheduledAt,nextRunAt:occurrence(s,scheduledAt,1),skipped:Math.max(0,countDates(s,from,to)-1)};
}
