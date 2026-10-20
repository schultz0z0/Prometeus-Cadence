import type {JobInput,ModuleId,ModuleResult,Decision} from '../../../domain/prospecting.ts';
export function suggestedQualification(decision:Decision){
  if(!decision.evidenceIds.length||decision.verdict==='insufficient_evidence'||decision.confidence===null)return'pending' as const;
  return decision.verdict==='fits'?'qualified' as const:'disqualified' as const;
}
export function chooseNextModule(input:Extract<JobInput,{kind:'qualification'}>,results:ModuleResult[],_policy:unknown=null):ModuleId|null{
  const done=new Set(results.map(r=>r.module));
  for(const module of ['registry','website','deep','email','phone','validateEmail','qualify','summary'] as ModuleId[]){
    if(!input.modules.includes(module)||done.has(module))continue;
    return module;
  }return null;
}
