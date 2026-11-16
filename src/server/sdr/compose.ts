import type {ConventionalRoute} from '../../domain/ai-routing.ts';
import type {SdrDraft} from '../../domain/sdr-policy.ts';
import {parseSdrOutput,parseSdrSearchPlan,sdrOutputJsonSchema,sdrPrompt,sdrSearchPlanJsonSchema,sdrSearchPlanPrompt,shouldPlanSearch,type SdrBookedMeeting,type SdrContact,type SdrFact,type SdrOutput,type SdrProposal} from '../../domain/sdr-turn.ts';
import {advance,pickOfferSlots,saleLinkProblem,startProgress,unlistedTimes,type SdrProgress} from '../../domain/sdr-stage.ts';
import {valueKey,valueMentions} from '../../domain/knowledge.ts';
import type {ConventionalContext} from '../prospecting/ai/json.ts';
import type {Passage} from '../knowledge/search.ts';
// One SDR answer: optional search plan, hybrid search over the company documents the agent reads, the reply with citations and
// memory, at most one more search when the model asks for it. Hard caps: 3 model calls, 2 searches.
// shortcut: value is untyped so test doubles can return fixed outputs; the parse callback is what validates it.
export type Generate=(ctx:ConventionalContext,request:{prompt:string;schema:unknown;maxOutputTokens:number;parse:(raw:unknown)=>any})=>Promise<{value:any;usage:unknown}>;
export type Search=(i:{workspaceId:string;documentIds:string[];queries:string[];signal:AbortSignal})=>Promise<{passages:Passage[];embedTokens:number}>;
/** Free calendar slots in a range (ISO instants); only the meetings objective asks for them. */
export type Slots=(range:{from:number;to:number})=>Promise<{timezone:string;slots:{start:string;end:string}[]}>;
export interface ComposeInput{workspaceId:string;operationId:string;operation:'sdr-turn'|'sdr-simulation';route:ConventionalRoute;signal:AbortSignal;draft:SdrDraft;context:unknown;
 knowledge:{kind:string;title:string;body:string}[];history:{id?:string;direction:string;text:string}[];incoming:string;incomingId:string|null;followup:{attempt:number;quote:string}|null;meeting:string|null;summary:string|null;facts:SdrFact[];progress?:SdrProgress|null;reminder?:SdrBookedMeeting|null}
export interface ComposeResult{out:SdrOutput;usage:unknown;sources:{id:string;documentId:string;title:string;label:string}[];alerts:{kind:'unsourced-value';value:string}[];memory:{summary:string|null;facts:SdrFact[]};
 progress:SdrProgress;proposal:SdrProposal|null;reason:string|null;contact:SdrContact|null;profile:SdrOutput['profile'];status:string}
// The reply prompt carries history, documents and memory; thinking models used the whole 4096 before writing a word.
const MAX_CALLS=3,MAX_SEARCHES=2,MAX_PASSAGES=8;
const HANDOFF_TEXT='Obrigado! Vou pedir para alguém da nossa equipe continuar a conversa com você por aqui.';
export async function composeSdrReply(i:ComposeInput,deps:{generate?:Generate;search?:Search;slots?:Slots}={}):Promise<ComposeResult>{
 // Defaults load lazily: they pull server-only modules the unit tests replace.
 const generate=(deps.generate??(await import('../prospecting/ai/json.ts')).runConventionalJson) as Generate,search=deps.search??(await import('../knowledge/search.ts')).searchKnowledge,fields=i.draft.qualification.map(q=>q.field),docs=i.draft.documentIds;
 let calls=0,searches=0,embedTokens=0,passages:Passage[]=[],usage:unknown=null;
 const ctx=(operation:ConventionalContext['operation'],n:number):ConventionalContext=>({operationId:i.operationId+(n?':'+n:''),workspaceId:i.workspaceId,signal:i.signal,route:i.route,agent:'sdr',operation});
 const find=async(queries:string[])=>{searches++;const r=await search({workspaceId:i.workspaceId,documentIds:docs,queries,signal:i.signal});embedTokens+=r.embedTokens;
  const seen=new Set(passages.map(p=>p.id));passages=[...passages,...r.passages.filter(p=>!seen.has(p.id))].slice(0,MAX_PASSAGES);};
 let progress=i.progress??startProgress(i.draft);
 const offering=progress.stage==='offer'||progress.stage==='qualified';
 // Offer and confirmation turns keep their calls for the reply; documents are searched only for a real question.
 if(docs.length&&shouldPlanSearch(i.incoming)&&(!offering||i.incoming.includes('?'))){
  calls++;const plan=await generate(ctx('sdr-search-plan',calls),{prompt:sdrSearchPlanPrompt({incoming:i.incoming,summary:i.summary,history:i.history}),schema:sdrSearchPlanJsonSchema,maxOutputTokens:4096,parse:parseSdrSearchPlan});
  if(plan.value.length)await find(plan.value);
 }
 const answer=async()=>{calls++;const r=await generate(ctx(i.operation,calls===1?0:calls),{prompt:sdrPrompt({draft:i.draft,context:i.context,knowledge:i.knowledge,history:i.history,incoming:i.incoming,incomingId:i.incomingId??undefined,followup:i.followup,meeting:i.meeting,reminder:i.reminder??null,
  passages:passages.map(p=>({id:p.id,title:p.title,label:p.label,text:p.text})),summary:i.summary,facts:i.facts,progress,offer:progress.offer}),schema:sdrOutputJsonSchema,maxOutputTokens:8192,parse:v=>parseSdrOutput(v,fields)});usage=r.usage;return r.value as SdrOutput;};
 const leadIds=new Set([...i.history.filter(h=>h.direction==='inbound'&&h.id).map(h=>h.id!),...(i.incomingId?[i.incomingId]:[])]);
 // The meetings objective offers real calendar slots once qualified; the app loads them, the model only picks from them.
 const openOffer=async(exclude:string[]=[])=>{
  if(i.draft.objective!=='meetings'||!deps.slots)return;
  const now=Date.now();
  // A calendar failure must not lose the turn: the conversation stays qualified and the agent answers without times.
  let r;try{r=await deps.slots({from:now,to:now+14*86400000});}catch{progress={...progress,stage:'qualified',offer:null};return;}
  const offer=pickOfferSlots(r.slots.filter(x=>!exclude.includes(x.start)),r.timezone);
  progress={...progress,stage:offer.slots.length?'offer':'qualified',offer:offer.slots.length?offer:null};
 };
 // An offer whose times already passed is replaced before the lead sees it again.
 if(progress.stage==='offer'&&progress.offer?.kind==='meeting'&&progress.offer.slots.some(x=>Date.parse(x.start)<=Date.now()))await openOffer();
 if(progress.stage==='qualified')await openOffer();
 let out=await answer();
 if(docs.length&&out.needMore.length&&calls<MAX_CALLS&&searches<MAX_SEARCHES){await find(out.needMore);out=await answer();}
 // The lead can't make the booked meeting: offer real times right away, never the current one. The old event stays until a new one exists.
 if(out.presence==='reschedule'&&i.reminder&&i.draft.objective==='meetings'&&progress.stage==='done'&&calls<MAX_CALLS){
  progress={...progress,stage:'qualified',offer:null};await openOffer([i.reminder.start]);if(progress.stage==='offer')out=await answer();
 }
 const step=(o:SdrOutput)=>advance(i.draft,progress,{fields:o.fields.map(f=>({field:f.field,value:f.value,messageId:f.messageId||i.incomingId||''})),refused:o.refused,leadIds});
 let moved=step(out);
 // This message completed the qualification: answer again under the objective's rules instead of waiting for the next one.
 if(!moved.handoff&&progress.stage==='qualifying'&&moved.progress.stage==='qualified'&&i.draft.objective!=='qualify-handoff'&&calls<MAX_CALLS){
  progress={...moved.progress};await openOffer();out=await answer();moved=step(out);
 }
 // A lead asking for another day gets fresh slots, never the ones already offered.
 if(progress.offer?.kind==='meeting'&&out.preference&&!out.chosen&&calls<MAX_CALLS){
  await openOffer(progress.offer.slots.map(x=>x.start));out=await answer();moved=step(out);
 }
 // Drafts are checked by the app: no time outside the offer, no link other than the configured one, nothing offered while qualifying.
 const problem=(o:SdrOutput)=>{
  const offer=progress.offer?.kind==='meeting'?progress.offer:null,link=i.draft.closing.link;
  if(progress.stage==='qualifying'&&((link&&o.reply.includes(link))||o.offered.length||o.chosen))return 'qualifying';
  if(offer&&unlistedTimes(o.reply,offer.slots).length)return 'time';
  if(i.draft.objective==='direct-sale'&&/https?:\/\//.test(o.reply)&&saleLinkProblem(o.reply,link))return 'link';
  return null;
 };
 while(problem(out)&&calls<MAX_CALLS){out=await answer();moved=step(out);}
 let reason:string|null=null,proposal:SdrProposal|null=null,status='';
 // A draft the app refused never reaches the lead: it moves nothing (no answer credited, no unanswered ask counted).
 if(problem(out)){out={...out,decision:'abstain'};reason='SDR_DRAFT_CHECK';}else progress=moved.progress;
 if(moved.handoff&&out.decision!=='abstain'){out={...out,decision:'handoff',reply:HANDOFF_TEXT};status='Passado para o time: '+moved.handoff;}
 // Qualify and pass on: only once the pain and a plan are understood, not on the first message of an agent without required questions.
 else if(out.decision==='reply'&&progress.stage!=='qualifying'&&i.draft.objective==='qualify-handoff'&&progress.stage!=='done'&&out.profile.pain&&out.profile.plan){out={...out,decision:'handoff'};status='Qualificado e passado para o time';}
 const offer=progress.offer?.kind==='meeting'?progress.offer:null,chosen=offer&&out.chosen?offer.slots.find(x=>x.id===out.chosen)??null:null;
 if(out.decision==='reply'&&chosen&&offer){proposal={kind:'meeting',slot:chosen,timezone:offer.timezone};status='Reunião escolhida: '+chosen.label;}
 // Presence is applied only when a person approves this reply.
 else if(out.decision==='reply'&&i.reminder&&out.presence)proposal={kind:'presence',value:out.presence,reservationId:i.reminder.reservationId};
 if(out.decision==='reply'&&i.draft.objective==='direct-sale'&&progress.stage!=='qualifying'&&i.draft.closing.link&&out.reply.includes(i.draft.closing.link)&&!saleLinkProblem(out.reply,i.draft.closing.link)){
  progress={...progress,stage:'done',offer:{kind:'sale',linkSentAt:new Date().toISOString()}};status='Link de fechamento enviado';
 }
 if(!status)status=progress.stage==='qualifying'?'Qualificando':progress.stage==='offer'?'Horários oferecidos':progress.stage==='done'?'Concluído':'Qualificado';
 const cited=passages.filter(p=>out.citations.includes(p.id));
 const sourced=new Set(valueMentions([JSON.stringify(i.context??''),...i.knowledge.map(k=>k.body),...cited.map(p=>p.text)].join(' ')).map(valueKey));
 const alerts=[...new Set(valueMentions(out.reply))].filter(v=>!sourced.has(valueKey(v))).map(value=>({kind:'unsourced-value' as const,value}));
 const facts=new Map(i.facts.map(f=>[f.key,f]));for(const f of out.facts)if(leadIds.has(f.messageId))facts.set(f.key,f);
 return {out:{...out,citations:cited.map(p=>p.id)},usage:{...(usage as object??{}),calls,embedTokens},sources:cited.map(p=>({id:p.id,documentId:p.documentId,title:p.title,label:p.label})),alerts,
  memory:{summary:out.summary||i.summary,facts:[...facts.values()].slice(-20)},progress,proposal,reason,contact:out.contact,profile:out.profile,status};
}
