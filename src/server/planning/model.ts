import type {PlanningInput,PlanningProposal,PlanningEvidence,PlanningBase,PlanningResult} from '../../domain/planning.ts';
import type {CompanyProfile} from '../../domain/model.ts';
import type {ApprovedProduct} from '../../domain/products.ts';
import {runConventionalJson,type ConventionalContext,type JsonDependencies} from '../prospecting/ai/json.ts';
import {validatePlanningResult} from './contracts.ts';
import {planningJsonSchema,planningPrompt} from './prompts.ts';
export async function generatePlanning(ctx:ConventionalContext&{jobId:string},input:{request:PlanningInput;sources:PlanningEvidence[];context:CompanyProfile|null;product:ApprovedProduct|null;base:PlanningBase},deps:JsonDependencies={}){
 const result=await runConventionalJson(ctx,{prompt:planningPrompt(input),schema:planningJsonSchema(input.request.task),maxOutputTokens:8192,parse(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('INVALID_PLANNING');
  const value=structuredClone(raw) as Record<string,any>;
  if(input.request.task==='audience_plan'&&Array.isArray(value.options))value.options=value.options.map((o:any,i:number)=>{
   if(input.request.task!=='audience_plan'||o.channel!==input.request.channel||o.schedules?.search?.timezone!==input.request.timezone||o.schedules?.qualification?.timezone!==input.request.timezone)throw Error('INVALID_AUDIENCE_SCOPE');
   if(Array.isArray(o.filters)&&new Set(o.filters.map((f:any)=>f.key)).size!==o.filters.length)throw Error('DUPLICATE_FILTER');
   const filters=Array.isArray(o.filters)?Object.fromEntries(o.filters.map((f:any)=>[f.key,f.value])):o.filters;
   return {...o,id:`option_${i+1}`,marketSize:o.marketSize===undefined?null:o.marketSize,filters};
  });
  if(input.request.task==='cadence_options'&&Array.isArray(value.options)){
   const delays=({'Curta':[1,2,2],'Padrão':[1,4,7],'Longa':[1,7,13]} as const)[input.request.rhythm as 'Curta'|'Padrão'|'Longa'];
   if(!delays)throw Error('INVALID_RHYTHM');
   value.options=value.options.map((o:any,i:number)=>({...o,id:`option_${i+1}`,steps:Array.isArray(o.steps)?o.steps.map((s:any,n:number)=>{
    if(input.request.task!=='cadence_options'||!input.request.channels.includes(s.channel))throw Error('INVALID_CHANNEL');
    const {subject,...rest}=s;return {...rest,delayDays:delays[n],...(subject===null||subject===undefined?{}:{subject})};
   }):o.steps}));
  }
  if(input.request.task==='message_preview'&&value.subject===null)delete value.subject;
  const parsed=validatePlanningResult(input.request.task,value,input.sources);if(!parsed.success)throw Error('INVALID_PLANNING');
  return {...parsed.data,task:input.request.task} as PlanningResult;
 }},deps);
 const proposal:PlanningProposal={...result.value,contractVersion:'planning-v1',jobId:ctx.jobId,base:input.base,evidenceIds:input.sources.map(s=>s.id),recommendedOptionId:null};
 return {proposal,usage:result.usage};
}
