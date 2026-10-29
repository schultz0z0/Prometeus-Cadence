import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import {evaluationInputSchema,validateResearchDataset,scoreResearchEvaluation,evaluationFingerprint,predictionSchema,type ResearchDataset,type ResearchCase,type EvaluationInput,type EvaluationPrediction,type EvaluationReport,type EvaluationFact} from '../../domain/research-evaluation.ts';
import {reviewCompanyPeople,sanitizePeopleSource,peopleContractVersion} from '../../domain/company-people.ts';
import {AI_SKILLS_VERSION} from '../../domain/ai-skills.ts';
import {companyPeopleRequest,ENRICHMENT_CONTRACT} from '../prospecting/ai/decisors.ts';
import {decide} from '../prospecting/ai/jev.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {getPools} from '../db/pool.ts';
import {isPlatformAiAdmin} from '../prospecting/ai/platform.ts';
import {readAiPolicy} from '../prospecting/ai/settings.ts';
import {conventionalConfig} from '../prospecting/ai/config.ts';
import {prospectingConfig} from '../prospecting/config.ts';
import {createReviewToken,verifyReviewToken,hashValue} from '../prospecting/review.ts';
import {AppError} from '../errors.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';

export interface EvaluationAuthority{provider:string;model:string;task:'contact-evidence';fingerprint:string}
export interface EvaluationAdapters{principal:Principal;dataset:unknown;reviewToken:string;liveOptIn?:boolean;replayOnly?:boolean;quote?:(caseId:string,variant:'traditional'|'hybrid')=>Promise<number|null>;run?:(row:ResearchCase,variant:'traditional'|'hybrid',authority:EvaluationAuthority)=>Promise<EvaluationPrediction>}
async function authorize(c:PoolClient,p:Principal){if(!await isPlatformAiAdmin(c))throw new AppError(403,'Somente a administração da plataforma pode homologar a inteligência.');const s=(await c.query('SELECT app.lock_channel_pilot_session($1) session',[p.sessionId])).rows[0].session;if(s?.workspaceId!==p.workspaceId)throw new AppError(403,'A sessão administrativa mudou ou venceu.');}
function parse(input:unknown,dataset:unknown){const d=validate(input,dataset);return d;}
function validate(input:unknown,raw:unknown){const parsed=evaluationInputSchema.safeParse(input);let dataset:ResearchDataset;try{dataset=validateResearchDataset(raw);}catch{throw new AppError(422,'Dataset de avaliação inválido.');}if(!parsed.success||parsed.data.datasetVersion!==dataset.version||parsed.data.caseIds.some(id=>!dataset.cases.some(c=>c.id===id)))throw new AppError(422,'Revise o dataset, os casos e o orçamento da avaliação.');return{input:parsed.data,dataset};}
async function basis(c:PoolClient,p:Principal,dataset:ResearchDataset){await authorize(c,p);const config=prospectingConfig(),policy=await readAiPolicy(c),runtime=conventionalConfig(p.workspaceId),provider=policy.conventionalProvider,route=provider?runtime.conventional[provider].route:null,database=(await c.query('SELECT app.journey_database_authority() value')).rows[0].value;
 const versions={actors:config.profiles,sourceVersion:config.version,model:route?.model??null,provider:route?.provider??null,routeFingerprint:route?.configFingerprint??null,skill:AI_SKILLS_VERSION,people:peopleContractVersion,extraction:ENRICHMENT_CONTRACT,jev:'typesafe/jev-1.13:decisions-v1',database};return{versions,database,fingerprint:evaluationFingerprint(dataset,versions),authority:{provider:provider??'unavailable',model:route?.model??'unavailable',task:'contact-evidence' as const,fingerprint:evaluationFingerprint(dataset,versions)}};
}
const signing=()=>{if(!process.env.BETTER_AUTH_SECRET)throw Error('Evaluation signing unavailable');return process.env.BETTER_AUTH_SECRET;};
const proof=(p:Principal,input:EvaluationInput,fingerprint:string)=>({action:'research.evaluate',workspaceId:p.workspaceId,actorId:p.userId,sessionId:p.sessionId,input,fingerprint});
export async function prepareResearchEvaluation(p:Principal,raw:unknown,gold:unknown){const {input,dataset}=parse(raw,gold);return withWorkspaceTransaction(p,async c=>{const b=await basis(c,p,dataset);return{input,token:createReviewToken(proof(p,input,b.fingerprint),signing()),expiresAt:new Date(Date.now()+600000).toISOString(),basisHash:b.fingerprint,blockers:[],warnings:['Fixtures comprovam contratos; não comprovam acurácia de fornecedores reais.','Sem teto de custo por operação, o modo live não inicia uma chamada.']};});}

const closureSchema=z.strictObject({runId:z.uuid(),requestId:z.uuid(),reason:z.literal('acknowledge-unresolved')});
type EvaluationClosure=z.infer<typeof closureSchema>;
function closureInput(raw:unknown){const parsed=closureSchema.safeParse(raw);if(!parsed.success)throw new AppError(422,'Revise o encerramento administrativo.');return parsed.data;}
function closureDataset(raw:unknown){try{return validateResearchDataset(raw);}catch{throw new AppError(422,'Dataset inválido.');}}
async function closureRow(c:PoolClient,id:string){const row=(await c.query('SELECT id,revision,state,lease_until,closed_by,closure_request_id FROM app.ai_evaluation_run WHERE id=$1',[id])).rows[0];if(!row)throw new AppError(404,'Avaliação não encontrada.');return row;}
function closable(row:{state:string;lease_until:Date}){if(!['running','uncertain'].includes(row.state)||row.lease_until.getTime()>Date.now())throw new AppError(409,'Aguarde o lease terminar ou confira o encerramento já registrado.');}
const closureProof=(p:Principal,input:EvaluationClosure,row:{revision:string;state:string;lease_until:Date},fingerprint:string)=>({action:'research.close',workspaceId:p.workspaceId,actorId:p.userId,sessionId:p.sessionId,input,revision:row.revision,state:row.state,leaseUntil:row.lease_until.toISOString(),fingerprint});
export async function prepareEvaluationClosure(p:Principal,raw:unknown,gold:unknown){const input=closureInput(raw),dataset=closureDataset(gold);return withWorkspaceTransaction(p,async c=>{const b=await basis(c,p,dataset),row=await closureRow(c,input.runId);closable(row);return{input,token:createReviewToken(closureProof(p,input,row,b.fingerprint),signing()),basisHash:b.fingerprint,expiresAt:new Date(Date.now()+600000).toISOString(),warnings:['Encerra sem repetir I/O e sem atestar sucesso ou ausência de cobrança. Custos desconhecidos permanecem desconhecidos.']};});}
export async function closeResearchEvaluation(p:Principal,raw:unknown,gold:unknown,token:string){const input=closureInput(raw),dataset=closureDataset(gold);await withWorkspaceTransaction(p,async c=>{const b=await basis(c,p,dataset);await lockWorkspace(c);const row=await closureRow(c,input.runId);if(row.state==='closed'){if(row.closed_by!==p.userId||row.closure_request_id!==input.requestId)throw new AppError(409,'O encerramento já foi registrado por outra solicitação.');return;}closable(row);verifyReviewToken(token,closureProof(p,input,row,b.fingerprint),signing());await c.query('SELECT app.close_evaluation($1,$2,$3,$4,$5,$6,$7)',[input.runId,row.revision,row.state,p.sessionId,input.requestId,input.reason,b.database]);});return readResearchEvaluation(p,input.runId,dataset);}
async function runningBasis(p:Principal,dataset:ResearchDataset,id:string,token:string,fingerprint:string){await withWorkspaceTransaction(p,async c=>{const current=await basis(c,p,dataset);if(current.fingerprint!==fingerprint)throw new AppError(409,'A base da avaliação mudou.','EVALUATION_CHANGED');const r=await c.query("SELECT id FROM app.ai_evaluation_run WHERE id=$1 AND actor_id=$2 AND lease_token=$3 AND state='running' AND lease_until>clock_timestamp()",[id,p.userId,token]);if(!r.rowCount)throw new AppError(409,'A avaliação perdeu o lease; confira os receipts e encerre com revisão.','EVALUATION_FENCE');});}

// Offline transport uses authored model proposals, production request builders,
// attribution validators and the actual structured JEV parser. No network I/O.
export async function fixtureResearchPrediction(row:ResearchCase,variant:'traditional'|'hybrid'):Promise<EvaluationPrediction>{
 const sources=row.sources.map(s=>({...s,text:sanitizePeopleSource(s.text),fetchedAt:'2026-10-28T12:00:00Z',hash:hashValue(s.text),truncated:false}));
 const request=companyPeopleRequest({company:row.company,knownNames:[],evidence:sources});const wire=JSON.parse(request.prompt);if(wire.skill.task!=='company_people')throw Error('Wrong extraction task');
 const people=reviewCompanyPeople({company:row.company,identity:{caseId:row.id,state:row.identity??'resolved',cnpj:row.company.cnpj??null,legalName:row.company.name,evidence:[]},sources:sources.map(s=>({id:s.id,url:s.url,quote:s.text,hash:s.hash,fetchedAt:s.fetchedAt,sourceVersion:'fixture-v1'})),partners:[],proposed:row.proposed});
 let allowed=true;if(variant==='hybrid'){
  const assessment=await decide({operationId:'fixture-'+row.id,signal:new AbortController().signal,credential:'fixture-never-sent',fetcher:async(url,init)=>{if(url!=='https://openrouter.ai/api/alpha/decisions')throw Error('Provider changed');const body=JSON.parse(String(init?.body));if(body.model!=='typesafe/jev-1.13'||body.state.skill.task!=='contact_evidence')throw Error('Task changed');return Response.json({answers:{fit:{type:'choice',choice:'fits'},quality:{type:'noul',noul:1},coverage:{type:'score',score:2}}});}},{intent:'contact-evidence',criteria:'Assess only supplied evidence',facts:{people},evidence:sources});allowed=assessment.verdict==='fits';
 }
 const facts:EvaluationFact[]=[];if(allowed)for(const p of people.filter(p=>p.current==='supported')){const e=p.evidence.at(-1)!;facts.push({subject:p.name,field:'person.name',value:p.name,sourceId:e.id,quote:e.quote},{subject:p.name,field:'person.role',value:p.role,sourceId:e.id,quote:e.quote});for(const contact of p.contacts.filter(c=>c.attribution==='personal'))facts.push({subject:p.name,field:('person.'+contact.kind) as EvaluationFact['field'],value:contact.value,sourceId:contact.evidence[0].id,quote:contact.evidence[0].quote});}
 return{caseId:row.id,variant,scopeId:row.scopeId,task:'contact-evidence',provider:'fixture',model:'authored-proposals',facts,costUsd:0,durationMs:0,receiptId:'fixture:'+row.id+':'+variant};
}
async function receipt(p:Principal,id:string,token:string,row:ResearchCase,variant:string,raw:unknown){
 const value=raw&&typeof raw==='object'?raw as Record<string,unknown>:{},cost=typeof value.costUsd==='number'&&Number.isFinite(value.costUsd)&&value.costUsd>=0?value.costUsd:null,duration=typeof value.durationMs==='number'&&Number.isFinite(value.durationMs)&&value.durationMs>=0?value.durationMs:0,receiptId=typeof value.receiptId==='string'&&value.receiptId.length>0&&value.receiptId.length<=160?value.receiptId:randomUUID();
 const client=await getPools().appPool.connect();try{await client.query('BEGIN');await client.query("SELECT set_config('app.workspace_id',$1,true),set_config('app.user_id',$2,true)",[p.workspaceId,p.userId]);await client.query('SELECT app.record_evaluation_receipt($1,$2,$3,$4,$5,$6,$7,$8)',[id,token,row.id,variant,receiptId,hashValue(raw),cost,duration]);await client.query('COMMIT');return{cost};}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export async function evaluateResearch(raw:EvaluationInput,deps:EvaluationAdapters):Promise<EvaluationReport>{
 const {input,dataset}=parse(raw,deps.dataset),p=deps.principal;
 if(input.mode==='live-owned'&&(!deps.liveOptIn||!deps.run||!deps.quote))throw new AppError(422,'Live exige opt-in, adapter próprio e teto por operação.');
 const selected={...dataset,cases:dataset.cases.filter(c=>input.caseIds.includes(c.id))},started=await withWorkspaceTransaction(p,async c=>{
  await authorize(c,p);await lockWorkspace(c);const b=await basis(c,p,dataset),old=(await c.query('SELECT * FROM app.ai_evaluation_run WHERE request_id=$1',[input.requestId])).rows[0],digest=hashValue(input);
  if(old){if(old.actor_id!==p.userId||old.body_hash!==digest||old.fingerprint!==b.fingerprint)throw new AppError(409,'A avaliação mudou. Prepare uma revisão atual.');if(old.report)return{old:old.report as EvaluationReport};throw new AppError(409,'A avaliação já iniciou. Confira o journal antes de repetir.');}
  verifyReviewToken(deps.reviewToken,proof(p,input,b.fingerprint),signing());const id=randomUUID(),token=randomUUID();await c.query('INSERT INTO app.ai_evaluation_run(workspace_id,id,actor_id,session_id,request_id,body_hash,fingerprint,input,versions,database_basis,lease_token) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[p.workspaceId,id,p.userId,p.sessionId,input.requestId,digest,b.fingerprint,input,b.versions,b.database,token]);return{id,token,b};
 });if('old' in started)return started.old!;
 const {id,token,b}=started,predictions:EvaluationPrediction[]=[];let knownCost=0,stop:string|null=null,uncertain=false,unknownQuote=false;
 for(const row of selected.cases){for(const variant of ['traditional','hybrid'] as const){
  await runningBasis(p,dataset,id,token,b.fingerprint);
  const upper=input.mode==='fixture'?0:await deps.quote!(row.id,variant);
  if(upper===null||!Number.isFinite(upper)||upper<0||input.mode==='live-owned'&&!deps.replayOnly&&upper===0||knownCost+upper>input.maxCostUsd){unknownQuote=upper===null||!Number.isFinite(upper);stop='BUDGET_OR_QUOTE_UNAVAILABLE';break;}
  await runningBasis(p,dataset,id,token,b.fingerprint);
  let rawResult:unknown;try{rawResult=input.mode==='fixture'?await fixtureResearchPrediction(row,variant):await deps.run!(row,variant,b.authority);}catch{rawResult={unavailable:true};}
  const received=await receipt(p,id,token,row,variant,rawResult);if(received.cost!==null)knownCost+=received.cost;
  let prediction:EvaluationPrediction;try{prediction=predictionSchema.parse(rawResult);}catch{stop='RESULT_UNCERTAIN';uncertain=true;break;}
  // Pin envelope to the reviewed task/route; no source may select a provider.
  if(prediction.caseId!==row.id||prediction.variant!==variant||input.mode==='live-owned'&&(prediction.provider!==b.authority.provider||prediction.model!==b.authority.model)){stop='OUTPUT_CONTRACT_CHANGED';uncertain=true;break;}
  predictions.push(prediction);
  await runningBasis(p,dataset,id,token,b.fingerprint);
  if(input.mode==='live-owned'&&(prediction.costUsd===null||prediction.costUsd>upper)){stop=prediction.costUsd===null?'UNKNOWN_COST':'COST_BOUND_EXCEEDED';break;}
 }if(stop)break;}
 let report:EvaluationReport;
 if(!stop)report={...scoreResearchEvaluation(selected,predictions),runId:id,fingerprint:b.fingerprint,mode:input.mode,empirical:false};
 else report={runId:id,fingerprint:b.fingerprint,mode:input.mode,empirical:false,accepted:false,unsupportedFacts:0,crossTenantLeaks:0,attributionPrecision:null,coverage:null,abstentionRate:null,cases:selected.cases.length,predictions:predictions.length,complete:false,knownCostUsd:knownCost,costUsd:predictions.some(p=>p.costUsd===null)||uncertain||unknownQuote?null:knownCost,unknownCosts:predictions.filter(p=>p.costUsd===null).length+(unknownQuote||uncertain?1:0),failures:[stop]};
 await withWorkspaceTransaction(p,async c=>{const current=await basis(c,p,dataset);if(current.fingerprint!==b.fingerprint)throw new AppError(409,'A base da avaliação mudou.');await c.query('SELECT app.finish_evaluation($1,$2,$3,$4,$5)',[id,token,b.fingerprint,report,uncertain?'uncertain':stop?'blocked':'completed']);});return report;
}
export async function readResearchEvaluation(p:Principal,id:string,gold:unknown){let dataset:ResearchDataset;try{dataset=validateResearchDataset(gold);}catch{throw new AppError(422,'Dataset inválido.');}return withWorkspaceTransaction(p,async c=>{const b=await basis(c,p,dataset),r=(await c.query('SELECT report,fingerprint,state,input FROM app.ai_evaluation_run WHERE id=$1',[id])).rows[0];if(!r)throw new AppError(404,'Avaliação não encontrada.');const current=r.fingerprint===b.fingerprint;
 if(!r.report||r.state==='closed'){const receipts=(await c.query('SELECT cost_usd FROM app.ai_evaluation_case WHERE run_id=$1',[id])).rows,knownCostUsd=receipts.reduce((n,r)=>n+Number(r.cost_usd??0),0),unknownCosts=receipts.filter(r=>r.cost_usd===null).length+(r.state==='closed'?1:0);return{current,state:r.state,report:{runId:id,fingerprint:r.fingerprint,mode:r.input.mode,empirical:false,accepted:false,complete:false,cases:r.input.caseIds.length,predictions:receipts.length,knownCostUsd,costUsd:null,unknownCosts,failures:[r.state==='closed'?'ADMIN_CLOSED_UNRESOLVED':'INCOMPLETE_REVIEW_RECEIPTS'],unsupportedFacts:0,crossTenantLeaks:0,attributionPrecision:null,coverage:null,abstentionRate:null}};}
 return{current,state:r.state,report:current?r.report:{...r.report,accepted:false,failures:[...r.report.failures,'STALE_FINGERPRINT']}};});}
