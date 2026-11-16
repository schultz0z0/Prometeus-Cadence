import type {SdrDraft} from './sdr-policy.ts';
// 16/11/2026: the app, not the model, decides where an SDR conversation stands. Every objective qualifies first:
// all required script questions answered from lead messages, at most 2 unanswered asks per question.
export type SdrStage='qualifying'|'qualified'|'offer'|'done';
export type SdrAnswers=Record<string,{value:string;messageId:string}>;
export type SdrOfferSlot={id:string;start:string;end:string;label:string};
export type SdrOffer={kind:'meeting';slots:SdrOfferSlot[];timezone:string}|{kind:'sale';linkSentAt:string|null};
export interface SdrProgress{stage:SdrStage;answers:SdrAnswers;attempts:Record<string,number>;asked:string|null;offer:SdrOffer|null}
const MAX_ASKS=2;
export function nextRequired(draft:SdrDraft,answers:SdrAnswers):string|null{
 return draft.qualification.find(q=>q.required&&!answers[q.field])?.field??null;
}
export function startProgress(draft:SdrDraft):SdrProgress{
 return {stage:nextRequired(draft,{})?'qualifying':'qualified',answers:{},attempts:{},asked:null,offer:null};
}
/** One lead turn: keeps answers that point to a lead message, counts unanswered asks, moves qualifying → qualified. */
export function advance(draft:SdrDraft,p:SdrProgress,turn:{fields:{field:string;value:string;messageId:string}[];refused:boolean;leadIds:Set<string>}):{progress:SdrProgress;handoff:string|null}{
 const script=new Set(draft.qualification.map(q=>q.field)),answers={...p.answers};
 for(const f of turn.fields)if(script.has(f.field)&&turn.leadIds.has(f.messageId)&&f.value.trim())answers[f.field]={value:f.value.trim(),messageId:f.messageId};
 const attempts={...p.attempts};let handoff:string|null=null;
 const pending=p.asked&&!answers[p.asked]?p.asked:null;
 if(pending){
  attempts[pending]=(attempts[pending]??0)+1;
  if(turn.refused||attempts[pending]>=MAX_ASKS)handoff='não respondeu a pergunta obrigatória: '+draft.qualification.find(q=>q.field===pending)!.question;
 }else if(turn.refused&&p.stage==='qualifying'){
  const field=nextRequired(draft,answers);if(field)handoff='não respondeu a pergunta obrigatória: '+draft.qualification.find(q=>q.field===field)!.question;
 }
 const missing=nextRequired(draft,answers);
 const stage=p.stage==='qualifying'&&!missing?'qualified':p.stage;
 return {progress:{...p,stage,answers,attempts,asked:stage==='qualifying'?missing:null},handoff};
}
const tzNames:Record<string,string>={'America/Sao_Paulo':'horário de Brasília'};
export const timezoneLabel=(tz:string)=>tzNames[tz]??tz;
function parts(iso:string,tz:string){
 const f=Object.fromEntries(new Intl.DateTimeFormat('pt-BR',{timeZone:tz,weekday:'long',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso)).map(x=>[x.type,x.value]));
 return {day:`${f.day}/${f.month}`,weekday:String(f.weekday).replace(/-feira$/,''),time:`${f.hour}:${f.minute}`};
}
export function slotLabel(start:string,tz:string){const p=parts(start,tz);return `${p.weekday}, ${p.day} às ${p.time}`;}
/** Up to `max` free slots, taken round-robin across days so the lead sees more than one day, then in time order. */
export function pickOfferSlots(slots:{start:string;end:string}[],timezone:string,max=6):SdrOffer&{kind:'meeting'}{
 const byDay=new Map<string,{start:string;end:string}[]>();
 for(const s of [...slots].sort((a,b)=>a.start.localeCompare(b.start))){const d=parts(s.start,timezone).day;byDay.set(d,[...(byDay.get(d)??[]),s]);}
 const picked:{start:string;end:string}[]=[],queues=[...byDay.values()];
 for(let i=0;picked.length<max&&queues.some(q=>q.length>i);i++)for(const q of queues)if(q[i]&&picked.length<max)picked.push(q[i]);
 picked.sort((a,b)=>a.start.localeCompare(b.start));
 return {kind:'meeting',timezone,slots:picked.map((s,i)=>({id:'s'+(i+1),start:s.start,end:s.end,label:slotLabel(s.start,timezone)}))};
}
const clock=(h:string,m?:string)=>h.padStart(2,'0')+':'+(m??'00');
/** Times written in the reply that are not one of the offered slots. */
export function unlistedTimes(reply:string,offer:{label:string}[]):string[]{
 const allowed=new Set(offer.flatMap(o=>[...o.label.matchAll(/(\d{1,2}):(\d{2})/g)].map(m=>clock(m[1],m[2]))));
 return [...reply.matchAll(/\b(\d{1,2})(?::(\d{2})|h(\d{2})?)(?![\w:])/g)].filter(m=>!allowed.has(clock(m[1],m[2]??m[3]))).map(m=>m[0]);
}
/** Null when the reply carries the configured closing link and no other URL. */
export function saleLinkProblem(reply:string,link:string):string|null{
 const urls=[...reply.matchAll(/https?:\/\/[^\s<>"')]+/g)].map(m=>m[0].replace(/[.,;:!?]+$/,''));
 if(!urls.includes(link))return 'A resposta não traz o link de fechamento configurado.';
 if(urls.some(u=>u!==link))return 'A resposta traz um link diferente do link de fechamento.';
 return null;
}
