import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {z} from 'zod';
import {evaluationInputSchema,predictionSchema,validateResearchDataset} from '../src/domain/research-evaluation.ts';
const manifestSchema=z.strictObject({datasetFile:z.string().min(1).max(2048),input:evaluationInputSchema});
const sessionSchema=z.strictObject({cookie:z.string().min(1).max(8192),workspaceId:z.string().min(1).max(120)});
function read(file:string,max:number){const stat=fs.statSync(file);if(!stat.isFile()||stat.size>max)throw Error('INPUT_LIMIT');return JSON.parse(fs.readFileSync(file,'utf8'));}
export async function runEvaluationCli(args:string[]){
 let pools:typeof import('../src/server/db/pool.ts')|undefined;
 try{
  const flags:Record<string,string>={};for(const a of args){const m=a.match(/^--(action|manifest|session|review|outputs|run-id|live-owned)=(.+)$/);if(!m||flags[m[1]])throw Error('FLAGS');flags[m[1]]=m[2];}
  if(!['check','prepare','run','read','prepare-close','close'].includes(flags.action)||!flags.manifest)throw Error('FLAGS');
  let manifest:z.infer<typeof manifestSchema>,dataset:ReturnType<typeof validateResearchDataset>;
  try{manifest=manifestSchema.parse(read(flags.manifest,32768));dataset=validateResearchDataset(read(manifest.datasetFile,2097152));if(manifest.input.datasetVersion!==dataset.version||manifest.input.caseIds.some(id=>!dataset.cases.some(c=>c.id===id)))throw Error('DATASET');}catch{return{exitCode:1,result:{accepted:false,code:'EVALUATION_MANIFEST_INVALID',pending:['dataset versionado, casos válidos, requestId e orçamento explícito']}};}
  if(flags.action==='check')return{exitCode:0,result:{valid:true,mode:manifest.input.mode,cases:manifest.input.caseIds.length,empirical:false}};
  if(!flags.session)throw Error('SESSION');const session=sessionSchema.parse(read(flags.session,16384));
  if(fs.existsSync('.env.local'))process.loadEnvFile('.env.local');
  const {requirePrincipal}=await import('../src/server/auth/principal.ts'),service=await import('../src/server/research/evaluation.ts');pools=await import('../src/server/db/pool.ts');
  const p=await requirePrincipal(new Headers({cookie:session.cookie}));if(p.workspaceId!==session.workspaceId)throw Error('SESSION_SCOPE');
  if(flags.action==='prepare')return{exitCode:0,result:await service.prepareResearchEvaluation(p,manifest.input,dataset)};
  if(flags.action==='prepare-close'){if(!flags['run-id'])throw Error('RUN_ID');return{exitCode:0,result:await service.prepareEvaluationClosure(p,{runId:flags['run-id'],requestId:manifest.input.requestId,reason:'acknowledge-unresolved'},dataset)};}
  if(flags.action==='read'){if(!flags['run-id'])throw Error('RUN_ID');const r=await service.readResearchEvaluation(p,flags['run-id'],dataset);return{exitCode:r.current&&r.report.accepted?0:1,result:r};}
  if(!flags.review)throw Error('REVIEW');const review=z.object({token:z.string().min(1).max(8192),basisHash:z.string().regex(/^[a-f0-9]{64}$/)}).parse(read(flags.review,32768));
  if(flags.action==='close'){if(!flags['run-id'])throw Error('RUN_ID');return{exitCode:0,result:await service.closeResearchEvaluation(p,{runId:flags['run-id'],requestId:manifest.input.requestId,reason:'acknowledge-unresolved'},dataset,review.token)};}
  if(manifest.input.mode==='fixture'){const r=await service.evaluateResearch(manifest.input,{principal:p,dataset,reviewToken:review.token});return{exitCode:r.accepted?0:1,result:r};}
  // Read-only benchmark of explicitly submitted owned outputs. Never dispatch
  // a provider, import executable adapters or promote this to empirical proof.
  if(flags['live-owned']!=='true'||!flags.outputs)throw Error('LIVE_OPT_IN');
  const output=z.strictObject({fingerprint:z.string(),predictions:z.array(predictionSchema).min(1).max(60)}).parse(read(flags.outputs,4194304));if(output.fingerprint!==review.basisHash)throw Error('OUTPUT_VERSIONS');
  const byId=new Map(output.predictions.map(v=>[v.caseId+':'+v.variant,v])),wanted=new Set(manifest.input.caseIds.flatMap(id=>['traditional','hybrid'].map(v=>id+':'+v)));if(byId.size!==output.predictions.length||byId.size!==wanted.size||[...wanted].some(id=>!byId.has(id)))throw Error('INCOMPLETE_OR_DUPLICATE_OUTPUT');
  const r=await service.evaluateResearch(manifest.input,{principal:p,dataset,reviewToken:review.token,liveOptIn:true,replayOnly:true,quote:async(id,variant)=>byId.get(id+':'+variant)?.costUsd??0,run:async(row,variant)=>{const value=byId.get(row.id+':'+variant);if(!value)throw Error('MISSING_OUTPUT');return value;}});
  return{exitCode:r.accepted?0:1,result:{...r,evidenceKind:'submitted-owned-outputs',providerDispatches:0}};
 }catch(error){const status=error&&typeof error==='object'&&'status'in error?Number(error.status):422;return{exitCode:1,result:{accepted:false,code:status===401?'UNAUTHENTICATED':status===403?'FORBIDDEN':status===409?'REVIEW_CHANGED':'EVALUATION_INPUT_INVALID',pending:['Revise sessão administrativa, manifesto, versão e orçamento. Nenhum erro bruto de fornecedor é publicado.']}};
 }finally{if(pools)await pools.getPools().close();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){const r=await runEvaluationCli(process.argv.slice(2));console.log(JSON.stringify(r.result,null,2));process.exitCode=r.exitCode;}
