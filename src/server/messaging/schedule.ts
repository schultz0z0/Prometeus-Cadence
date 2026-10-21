import {localDateAt,wallTimeToUtc} from '../../domain/schedule.ts';
export interface NextStepInput {anchorAt:string;delayDays:number;now:string;timezone:string;weekdays:number[];sendTime:string;skipHolidays:boolean;holidayDates:string[]|null}
const DAY=86400000;
function localTimeAt(iso:string,zone:string){
 return new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso));
}
function addDays(date:string,count:number){return new Date(Date.parse(date+'T00:00:00Z')+count*DAY).toISOString().slice(0,10);}
export function nextStepAt(input:NextStepInput):string {
 const anchor=Date.parse(input.anchorAt),now=Date.parse(input.now);
 if(!Number.isFinite(anchor)||!Number.isFinite(now)||!Number.isInteger(input.delayDays)||input.delayDays<0||input.delayDays>3650||!input.weekdays.length||input.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6)||new Set(input.weekdays).size!==input.weekdays.length)throw Error('Agenda inválida.');
 if(input.skipHolidays&&!input.holidayDates)throw Error('Configure um calendário explícito de feriados.');
 const date=addDays(localDateAt(input.anchorAt,input.timezone),input.delayDays);
 const due=Date.parse(wallTimeToUtc(date,localTimeAt(input.anchorAt,input.timezone),input.timezone));
 const minimum=Math.max(due,now),start=localDateAt(new Date(minimum).toISOString(),input.timezone);
 for(let days=0;days<3660;days++){
  const candidate=addDays(start,days),weekday=new Date(candidate+'T00:00:00Z').getUTCDay();
  if(!input.weekdays.includes(weekday)||(input.skipHolidays&&input.holidayDates!.includes(candidate)))continue;
  const at=wallTimeToUtc(candidate,input.sendTime,input.timezone);
  if(Date.parse(at)>=minimum)return at;
 }
 throw Error('Nenhum horário de envio disponível no calendário.');
}
