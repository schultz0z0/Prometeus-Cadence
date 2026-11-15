import type {ConventionalRoute} from '../../domain/ai-routing.ts';
import type {SdrDraft} from '../../domain/sdr-policy.ts';
import {parseSdrOutput,parseSdrSearchPlan,sdrOutputJsonSchema,sdrPrompt,sdrSearchPlanJsonSchema,sdrSearchPlanPrompt,shouldPlanSearch,type SdrFact,type SdrOutput} from '../../domain/sdr-turn.ts';
import {valueMentions} from '../../domain/knowledge.ts';
import type {ConventionalContext} from '../prospecting/ai/json.ts';
import type {Passage} from '../knowledge/search.ts';
// One SDR answer: optional search plan, hybrid search over the company documents the agent reads, the reply with citations and
// memory, at most one more search when the model asks for it. Hard caps: 3 model calls, 2 searches.
// shortcut: value is untyped so test doubles can return fixed outputs; the parse callback is what validates it.
export type Generate=(ctx:ConventionalContext,request:{prompt:string;schema:unknown;maxOutputTokens:number;parse:(raw:unknown)=>any})=>Promise<{value:any;usage:unknown}>;
export type Search=(i:{workspaceId:string;documentIds:string[];queries:string[];signal:AbortSignal})=>Promise<{passages:Passage[];embedTokens:number}>;
export interface ComposeInput{workspaceId:string;operationId:string;operation:'sdr-turn'|'sdr-simulation';route:ConventionalRoute;signal:AbortSignal;draft:SdrDraft;context:unknown;
 knowledge:{kind:string;title:string;body:string}[];history:{id?:string;direction:string;text:string}[];incoming:string;incomingId:string|null;followup:{attempt:number;quote:string}|null;meeting:string|null;summary:string|null;facts:SdrFact[]}
export interface ComposeResult{out:SdrOutput;usage:unknown;sources:{id:string;documentId:string;title:string;label:string}[];alerts:{kind:'unsourced-value';value:string}[];memory:{summary:string|null;facts:SdrFact[]}}
const MAX_CALLS=3,MAX_SEARCHES=2,MAX_PASSAGES=8;
const squash=(s:string)=>s.replace(/\s+/g,'').toLowerCase();
export async function composeSdrReply(i:ComposeInput,deps:{generate?:Generate;search?:Search}={}):Promise<ComposeResult>{
 // Defaults load lazily: they pull server-only modules the unit tests replace.
 const generate=(deps.generate??(await import('../prospecting/ai/json.ts')).runConventionalJson) as Generate,search=deps.search??(await import('../knowledge/search.ts')).searchKnowledge,fields=i.draft.qualification.map(q=>q.field),docs=i.draft.documentIds;
 let calls=0,searches=0,embedTokens=0,passages:Passage[]=[],usage:unknown=null;
 const ctx=(operation:ConventionalContext['operation'],n:number):ConventionalContext=>({operationId:i.operationId+(n?':'+n:''),workspaceId:i.workspaceId,signal:i.signal,route:i.route,agent:'sdr',operation});
 const find=async(queries:string[])=>{searches++;const r=await search({workspaceId:i.workspaceId,documentIds:docs,queries,signal:i.signal});embedTokens+=r.embedTokens;
  const seen=new Set(passages.map(p=>p.id));passages=[...passages,...r.passages.filter(p=>!seen.has(p.id))].slice(0,MAX_PASSAGES);};
 if(docs.length&&shouldPlanSearch(i.incoming)){
  calls++;const plan=await generate(ctx('sdr-search-plan',calls),{prompt:sdrSearchPlanPrompt({incoming:i.incoming,summary:i.summary,history:i.history}),schema:sdrSearchPlanJsonSchema,maxOutputTokens:4096,parse:parseSdrSearchPlan});
  if(plan.value.length)await find(plan.value);
 }
 const answer=async()=>{calls++;const r=await generate(ctx(i.operation,calls===1?0:calls),{prompt:sdrPrompt({draft:i.draft,context:i.context,knowledge:i.knowledge,history:i.history,incoming:i.incoming,incomingId:i.incomingId??undefined,followup:i.followup,meeting:i.meeting,
  passages:passages.map(p=>({id:p.id,title:p.title,label:p.label,text:p.text})),summary:i.summary,facts:i.facts}),schema:sdrOutputJsonSchema,maxOutputTokens:4096,parse:v=>parseSdrOutput(v,fields)});usage=r.usage;return r.value;};
 let out=await answer();
 if(docs.length&&out.needMore.length&&calls<MAX_CALLS&&searches<MAX_SEARCHES){await find(out.needMore);out=await answer();}
 const cited=passages.filter(p=>out.citations.includes(p.id));
 const sourceText=squash([JSON.stringify(i.context??''),...i.knowledge.map(k=>k.body),...cited.map(p=>p.text)].join(' '));
 const alerts=[...new Set(valueMentions(out.reply))].filter(v=>!sourceText.includes(squash(v))).map(value=>({kind:'unsourced-value' as const,value}));
 const leadIds=new Set([...i.history.filter(h=>h.direction==='inbound'&&h.id).map(h=>h.id!),...(i.incomingId?[i.incomingId]:[])]);
 const facts=new Map(i.facts.map(f=>[f.key,f]));for(const f of out.facts)if(leadIds.has(f.messageId))facts.set(f.key,f);
 return {out:{...out,citations:cited.map(p=>p.id)},usage:{...(usage as object??{}),calls,embedTokens},sources:cited.map(p=>({id:p.id,documentId:p.documentId,title:p.title,label:p.label})),alerts,
  memory:{summary:out.summary||i.summary,facts:[...facts.values()].slice(-20)}};
}
