import {createHash} from 'node:crypto';
import {z} from 'zod';
import {sanitizePeopleSource} from './company-people.ts';
const fact=z.strictObject({subject:z.string().min(1).max(200),field:z.enum(['company.name','company.email','company.phone','person.name','person.role','person.email','person.phone','person.linkedin']),value:z.string().min(1).max(500)});
const source=z.strictObject({id:z.string().min(1).max(120),url:z.url().max(2048),text:z.string().max(12000)});
export const researchCaseSchema=z.strictObject({id:z.string().regex(/^[\w-]{1,80}$/),category:z.string().min(1).max(80),scopeId:z.string().min(1).max(120),company:z.strictObject({id:z.string(),name:z.string(),cnpj:z.string().optional(),email:z.string().optional(),phone:z.string().optional()}),sources:z.array(source).max(10),proposed:z.unknown(),expected:z.array(fact).max(100),mustAbstain:z.boolean(),identity:z.enum(['resolved','missing','conflict']).optional()});
const datasetSchema=z.strictObject({version:z.string().regex(/^[\w.-]{1,100}$/),cases:z.array(researchCaseSchema).min(1).max(30)});
export type ResearchDataset=z.infer<typeof datasetSchema>;
export type ResearchCase=ResearchDataset['cases'][number];
export type EvaluationFact=z.infer<typeof fact>&{sourceId:string;quote:string};
export const predictionSchema=z.strictObject({caseId:z.string(),variant:z.enum(['traditional','hybrid']),scopeId:z.string(),task:z.literal('contact-evidence'),provider:z.string().min(1).max(80),model:z.string().min(1).max(160),facts:z.array(fact.extend({sourceId:z.string().max(120),quote:z.string().min(1).max(12000)})).max(100),costUsd:z.number().finite().nonnegative().nullable(),durationMs:z.number().finite().nonnegative(),receiptId:z.string().min(1).max(160)});
export type EvaluationPrediction=z.infer<typeof predictionSchema>;
export const evaluationInputSchema=z.strictObject({requestId:z.uuid(),datasetVersion:z.string().min(1).max(100),caseIds:z.array(z.string().regex(/^[\w-]{1,80}$/)).min(1).max(30).refine(v=>new Set(v).size===v.length),mode:z.enum(['fixture','live-owned']),maxCostUsd:z.number().finite().min(0).max(1000)}).refine(v=>v.mode==='fixture'||v.maxCostUsd>0,{message:'Live evaluation requires a positive budget'});
export type EvaluationInput=z.infer<typeof evaluationInputSchema>;
export interface EvaluationReport{runId:string;accepted:boolean;unsupportedFacts:number;crossTenantLeaks:number;attributionPrecision:number|null;coverage:number|null;costUsd:number|null;knownCostUsd:number;unknownCosts:number;abstentionRate:number|null;cases:number;predictions:number;complete:boolean;failures:string[];fingerprint:string;mode:'fixture'|'live-owned';empirical:false}
export function validateResearchDataset(raw:unknown):ResearchDataset{
 const parsed=datasetSchema.safeParse(raw);if(!parsed.success)throw Error('Invalid research dataset');const d=parsed.data;
 if(new Set(d.cases.map(c=>c.id)).size!==d.cases.length||d.cases.some(c=>new Set(c.sources.map(s=>s.id)).size!==c.sources.length||c.company.id!==c.scopeId||c.mustAbstain&&c.expected.some(f=>f.field==='person.email'||f.field==='person.phone')))throw Error('Invalid research dataset labels');return d;
}
const stable=(v:unknown):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stable(v)).join(',')+'}';
export const evaluationFingerprint=(dataset:unknown,versions:Record<string,unknown>)=>createHash('sha256').update(stable({dataset,versions})).digest('hex');
export function acceptResearchEvaluation(input:{unsupportedFacts:number;crossTenantLeaks:number;attributionPrecision:number|null}){return input.unsupportedFacts===0&&input.crossTenantLeaks===0&&input.attributionPrecision!==null&&Number.isFinite(input.attributionPrecision)&&input.attributionPrecision>=.95&&input.attributionPrecision<=1;}
const key=(f:{subject:string;field:string;value:string})=>JSON.stringify([f.subject,f.field,f.value]);
const personal=(f:{field:string})=>['person.email','person.phone','person.linkedin'].includes(f.field);
export function scoreResearchEvaluation(raw:unknown,values:unknown[]):Omit<EvaluationReport,'runId'|'fingerprint'|'mode'|'empirical'>{
 const dataset=validateResearchDataset(raw),predictions=values.map(v=>predictionSchema.parse(v));
 const wanted=new Set(dataset.cases.flatMap(c=>['traditional','hybrid'].map(v=>c.id+':'+v))),seen=new Set<string>();
 for(const p of predictions){const k=p.caseId+':'+p.variant;if(!wanted.has(k)||seen.has(k))throw Error('Invalid prediction set');seen.add(k);}if(seen.size!==wanted.size)throw Error('Incomplete prediction set');
 let unsupportedFacts=0,crossTenantLeaks=0,correctAttributions=0,attributions=0,matched=0,expected=0,abstentions=0,abstentionCases=0,knownCostUsd=0,unknownCosts=0;const failures:string[]=[];
 for(const p of predictions){const c=dataset.cases.find(c=>c.id===p.caseId)!,good=new Set<string>(),expectedKeys=new Set(c.expected.map(key));if(p.scopeId!==c.scopeId){crossTenantLeaks++;failures.push(c.id+':scope');}
  for(const f of p.facts){const s=c.sources.find(s=>s.id===f.sourceId),supported=!!s&&sanitizePeopleSource(s.text).includes(f.quote)&&f.quote.includes(f.value)&&expectedKeys.has(key(f))&&p.scopeId===c.scopeId;
   if(!supported){unsupportedFacts++;failures.push(c.id+':unsupported');}else good.add(key(f));if(personal(f)){attributions++;if(supported)correctAttributions++;}}
  matched+=good.size;expected+=expectedKeys.size;if(c.mustAbstain){abstentionCases++;if(!p.facts.some(personal))abstentions++;else failures.push(c.id+':abstention');}
  if(p.costUsd===null)unknownCosts++;else knownCostUsd+=p.costUsd;
 }
 const attributionPrecision=attributions?correctAttributions/attributions:null,coverage=expected?matched/expected:null,abstentionRate=abstentionCases?abstentions/abstentionCases:null;
 const complete=dataset.cases.length===30&&seen.size===60;
 return{accepted:complete&&acceptResearchEvaluation({unsupportedFacts,crossTenantLeaks,attributionPrecision})&&abstentionRate===1,unsupportedFacts,crossTenantLeaks,attributionPrecision,coverage,abstentionRate,costUsd:unknownCosts?null:knownCostUsd,knownCostUsd,unknownCosts,cases:dataset.cases.length,predictions:predictions.length,complete,failures:[...new Set(failures)]};
}
