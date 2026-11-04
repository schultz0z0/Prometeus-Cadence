import 'server-only';
import {randomUUID} from 'node:crypto';
import type {ConventionalRoute} from '../../domain/ai-routing.ts';
import {resolveAiRoute} from '../../domain/ai-routing.ts';
import {sdrDraftSchema} from '../../domain/sdr-policy.ts';
import {parseSdrOutput,sdrOutputJsonSchema,sdrPrompt,type SdrOutput} from '../../domain/sdr-turn.ts';
import {workerPool} from '../prospecting/worker-db.ts';
import {readAiPolicy} from '../prospecting/ai/settings.ts';
import {conventionalConfig} from '../prospecting/ai/config.ts';
import {runConventionalJson,type ConventionalContext} from '../prospecting/ai/json.ts';
// 07B.2: one turn per inbound. The draft waits for a person; this worker never queues a message.
type Generate=(ctx:ConventionalContext,request:{prompt:string;schema:unknown;maxOutputTokens:number;parse:(raw:unknown)=>SdrOutput})=>Promise<{value:SdrOutput;usage:unknown}>;
export type SdrWorkerDeps={generate?:Generate;route?:ConventionalRoute|null};
type Claim={workspaceId:string;turnId:string;config:unknown;context:unknown;knowledge:{kind:string;title:string;body:string}[];incoming:string;history:{direction:string;text:string}[]};
export async function runSdrTick(o:{limit:number;now?:Date;workspaceId?:string;signal?:AbortSignal},deps:SdrWorkerDeps={}){
 const pool=workerPool(),token=randomUUID();let processed=0;
 for(;processed<o.limit&&!o.signal?.aborted;processed++){
  const now=o.now??new Date(),claim=(await pool.query('SELECT app.sdr_claim_turn($1,$2,$3) v',[token,now,o.workspaceId??null])).rows[0].v as Claim|null;
  if(!claim)break;
  const finish=(decision:string|null,text:string|null,fields:unknown,usage:unknown,reason:string|null)=>pool.query('SELECT app.sdr_finish_turn($1,$2,$3,$4,$5,$6,$7,$8,$9)',[claim.workspaceId,claim.turnId,token,decision,text,JSON.stringify(fields),usage==null?null:JSON.stringify(usage),reason,now]);
  try{
   let route=deps.route;
   if(route===undefined){
    const c=await pool.connect();
    try{const resolved=resolveAiRoute({...await readAiPolicy(c),mode:'conventional-only',jevEnabled:false},conventionalConfig(claim.workspaceId),null);route=resolved.route&&resolved.route.conventional.provider!=='codex-local'?resolved.route.conventional:null;}finally{c.release();}
   }
   if(!route){await finish(null,null,[],null,'AI_UNAVAILABLE');continue;}
   const draft=sdrDraftSchema.parse(claim.config),fields=draft.qualification.map(q=>q.field),signal=AbortSignal.any([AbortSignal.timeout(90000),...(o.signal?[o.signal]:[])]);
   const r=await(deps.generate??runConventionalJson)({operationId:'sdr-turn:'+claim.turnId,workspaceId:claim.workspaceId,signal,route},
    {prompt:sdrPrompt({draft,context:claim.context,knowledge:claim.knowledge,history:claim.history,incoming:claim.incoming}),schema:sdrOutputJsonSchema,maxOutputTokens:4096,parse:v=>parseSdrOutput(v,fields)});
   const out=r.value,empty=out.decision==='reply'&&!out.reply;
   await finish(empty?'abstain':out.decision,out.reply||null,out.fields,r.usage,empty?'EMPTY_REPLY':null);
  }catch{await finish(null,null,[],null,'AI_FAILED');}// The provider may have answered: stays uncertain, no blind retry.
 }
 return {processed};
}
