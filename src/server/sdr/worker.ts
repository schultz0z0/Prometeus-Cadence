import 'server-only';
import {randomUUID} from 'node:crypto';
import type {ConventionalRoute} from '../../domain/ai-routing.ts';
import {resolveAiRoute} from '../../domain/ai-routing.ts';
import {sdrDraftSchema} from '../../domain/sdr-policy.ts';
import {sdrProposal,type SdrFact} from '../../domain/sdr-turn.ts';
import {composeSdrReply,type Generate,type Search,type Slots} from './compose.ts';
import type {SdrProgress} from '../../domain/sdr-stage.ts';
import {workerPool} from '../prospecting/worker-db.ts';
import {readAiPolicy} from '../prospecting/ai/settings.ts';
import {conventionalConfig} from '../prospecting/ai/config.ts';
// 07B.2: one turn per inbound. The draft waits for a person; this worker never queues a message.
export type SdrWorkerDeps={generate?:Generate;search?:Search;route?:ConventionalRoute|null;slots?:Slots};
type Claim={workspaceId:string;turnId:string;config:unknown;context:unknown;knowledge:{kind:string;title:string;body:string}[];incoming:string;history:{id:string;direction:string;text:string}[];followup:{attempt:number;quote:string}|null;meeting:string|null;incomingId:string|null;summary:string|null;facts:SdrFact[];progress:SdrProgress|null;conversationId:string;calendarReady:boolean};
export async function runSdrTick(o:{limit:number;now?:Date;workspaceId?:string;signal?:AbortSignal},deps:SdrWorkerDeps={}){
 const pool=workerPool(),token=randomUUID();let processed=0;
 for(;processed<o.limit&&!o.signal?.aborted;processed++){
  const now=o.now??new Date(),claim=(await pool.query('SELECT app.sdr_claim_turn($1,$2,$3) v',[token,now,o.workspaceId??null])).rows[0].v as Claim|null;
  if(!claim)break;
  const finish=(decision:string|null,text:string|null,fields:unknown,usage:unknown,reason:string|null,proposal:unknown=null,memory:unknown=null,progress:unknown=null)=>pool.query('SELECT app.sdr_finish_turn($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[claim.workspaceId,claim.turnId,token,decision,text,JSON.stringify(fields),usage==null?null:JSON.stringify(usage),reason,now,proposal&&JSON.stringify(proposal),memory&&JSON.stringify(memory),progress&&JSON.stringify(progress)]);
  try{
   let route=deps.route;
   if(route===undefined){
    const c=await pool.connect();
    try{const resolved=resolveAiRoute({...await readAiPolicy(c),mode:'conventional-only',jevEnabled:false},conventionalConfig(claim.workspaceId,'sdr'),null);route=resolved.route&&resolved.route.conventional.provider!=='codex-local'?resolved.route.conventional:null;}finally{c.release();}
   }
   if(!route){await finish(null,null,[],null,'AI_UNAVAILABLE');continue;}
   const draft=sdrDraftSchema.parse(claim.config),signal=AbortSignal.any([AbortSignal.timeout(90000),...(o.signal?[o.signal]:[])]);
   // The lead record follows the conversation: linked by number, or created in the "Agente SDR" list.
   await pool.query('SELECT app.sdr_ensure_lead($1,$2)',[claim.workspaceId,claim.conversationId]);
   const slots:Slots|undefined=deps.slots??(claim.calendarReady?async range=>(await import('../integrations/calendar.ts')).readWorkerSlots(pool,claim.workspaceId,range):undefined);
   const r=await composeSdrReply({workspaceId:claim.workspaceId,operationId:'sdr-turn:'+claim.turnId,operation:'sdr-turn',route,signal,draft,context:claim.context,knowledge:claim.knowledge,
    history:claim.history,incoming:claim.incoming,incomingId:claim.incomingId,followup:claim.followup,meeting:claim.meeting,summary:claim.summary??null,facts:claim.facts??[],progress:claim.progress},{generate:deps.generate,search:deps.search,slots});
   const out=r.out,empty=out.decision==='reply'&&!out.reply;
   await finish(empty?'abstain':out.decision,out.reply||null,out.fields,r.usage,empty?'EMPTY_REPLY':r.reason,r.proposal??sdrProposal(out,claim.incoming,draft.followupEnabled),{sources:r.sources,alerts:r.alerts,...r.memory},
    {...r.progress,contact:r.contact,profile:r.profile,status:r.status});
  }catch(e){
   // The provider may have answered: stays uncertain, no blind retry. Only the error code is kept, never the message.
   const code=(e as {code?:unknown})?.code;
   await finish(null,null,[],{error:typeof code==='string'&&/^[A-Z0-9_]{1,80}$/.test(code)?code:'UNKNOWN'},'AI_FAILED');
  }
 }
 return {processed};
}
