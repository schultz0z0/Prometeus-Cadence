import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {AutomationDefinition,AutomationAuthorization} from '../../domain/automation-runtime.ts';
import type {ModuleId,ProspectingInput} from '../../domain/prospecting.ts';
import {resolveAiRoute} from '../../domain/ai-routing.ts';
import {workspaceProspectingConfig} from '../prospecting/workspace-config.ts';
import {readAiPolicy} from '../prospecting/ai/settings.ts';
import {conventionalConfig} from '../prospecting/ai/config.ts';
import {readConnectionCheck} from '../prospecting/ai/connection.ts';
import {estimateUsage,requirements} from '../prospecting/config.ts';
import {jobInputSchema} from '../prospecting/schemas.ts';
import {readApprovedContext} from '../context/repository.ts';
import {hashValue} from '../prospecting/review.ts';
import {qualificationOptionsFromFilters} from '../../domain/qualification-policy.ts';
const moduleNames:Record<string,ModuleId>={email:'email',phone:'phone',website:'website',summary:'summary',deep:'deep',validateEmail:'validateEmail',registry:'registry',qualify:'qualify','Qualificação por IA':'qualify','Resumo com IA':'summary','Extrair e-mails':'email','Extrair telefones':'phone'};
export async function automationAuthorizationState(c:PoolClient,p:Principal,definition:AutomationDefinition,freshOperationId?:string){
 const {config,policy}=await workspaceProspectingConfig(c),blockers:string[]=[],payload=definition.payload,modules=payload.modules.map(m=>moduleNames[m]).filter(Boolean),context=await readApprovedContext(c);
 if(modules.length!==payload.modules.length||new Set(modules).size!==modules.length)blockers.push('A automação contém módulos não suportados ou repetidos.');
 if(payload.dailyLimit>500)blockers.push('O limite por ocorrência deve ser de no máximo 500 empresas.');
 if(!definition.schedule)blockers.push('Revise a programação: data inicial, frequência, dias e fuso são obrigatórios.');
 let product=null;if(definition.productId){const row=(await c.query('SELECT approved,archived FROM app.product_profile WHERE id=$1',[definition.productId])).rows[0];product=row&&!row.archived?row.approved:null;if(!product)blockers.push('O produto precisa de uma versão aprovada disponível.');}
 const needsAi=payload.source==='QUALIFY'&&modules.some(m=>m==='qualify'||m==='summary');let aiRoute=null;
 if(needsAi){const aiPolicy=await readAiPolicy(c),runtime=conventionalConfig(p.workspaceId),route=aiPolicy.conventionalProvider?runtime.conventional[aiPolicy.conventionalProvider].route:null,resolution=resolveAiRoute(aiPolicy,runtime,route?await readConnectionCheck(c,route,freshOperationId):null);aiRoute=resolution.route;blockers.push(...resolution.blockers);}
 if(modules.includes('qualify')&&(!context?.offer||!context.idealCustomer))blockers.push('Aprove oferta e cliente ideal antes de qualificar.');
 let input:ProspectingInput|null=null;
 if(['MAPS','WEB','CNPJ','APOLLO'].includes(payload.source)){
  if(payload.modules.length)blockers.push('Separe a busca e os módulos de qualificação em automações próprias.');
  const {dedup,channel,scope,...filters}=payload.filters;
  if(scope!==undefined&&!['list','workspace'].includes(scope))blockers.push('O escopo de deduplicação não é válido.');
  const parsed=jobInputSchema.safeParse({kind:'generation',source:payload.source,destination:{mode:'existing',listId:payload.listId},filters,limit:payload.dailyLimit,dedupScope:scope==='list'?'list':'workspace'});
  if(parsed.success)input=parsed.data;else blockers.push('A fonte ou os filtros não têm um contrato de busca válido.');
 }else if(payload.source==='QUALIFY'){
  // Forecast IDs count calls only; no lead or list is created for an estimate.
  let options;try{options=qualificationOptionsFromFilters(payload.filters);}catch{blockers.push('Revise os filtros e o idioma da qualificação.');}
  const parsed=jobInputSchema.safeParse({kind:'qualification',listId:payload.listId,leadIds:Array.from({length:Math.min(payload.dailyLimit,501)},(_,i)=>'forecast-'+i),modules,summaryPolicy:'all',escalation:'off',...(options&&Object.keys(options).length?{options}:{})});
  if(parsed.success)input=parsed.data;else blockers.push('Revise os módulos e o volume de qualificação.');
 }else if(payload.source==='REENGAGE'){
  const {sourceListId,sourceCadenceId,afterDays,...unknown}=payload.filters;
  if(payload.modules.length||Object.keys(unknown).some(k=>!['dedup','scope','term','location'].includes(k))||!sourceListId||sourceListId===payload.listId||!/^\d+$/.test(afterDays??'')||Number(afterDays)<1||Number(afterDays)>3650)blockers.push('Selecione listas distintas e um intervalo de 1 a 3650 dias, sem módulos de qualificação.');
  if(!(await c.query('SELECT 1 FROM app.list WHERE id=$1',[sourceListId??''])).rowCount)blockers.push('A lista de origem não está disponível neste workspace.');
  if(sourceCadenceId&&!(await c.query('SELECT 1 FROM app.cadence WHERE id=$1 AND list_id=$2',[sourceCadenceId,sourceListId])).rowCount)blockers.push('A cadência de origem não pertence à lista selecionada.');
 }else blockers.push('Esta fonte ainda não possui execução recorrente.');
 if(input)blockers.push(...requirements(config,input,p.workspaceId,aiRoute));
 if(definition.dependsOnAutomationId){
  const dependency=(await c.query("SELECT d.payload->>'listId' AS list_id,d.payload FROM app.automation_definition d JOIN app.automation_runtime r ON r.workspace_id=d.workspace_id AND r.automation_id=d.automation_id AND r.definition_revision=d.revision WHERE d.automation_id=$1",[definition.dependsOnAutomationId])).rows[0];
  if(payload.source!=='QUALIFY'||!dependency||dependency.list_id!==payload.listId||!['MAPS','WEB','CNPJ','APOLLO'].includes(dependency.payload.source)||definition.dependsOnAutomationId===definition.id)blockers.push('A dependência precisa ser uma busca da mesma lista.');
 }
 const draft:Omit<AutomationAuthorization,'id'|'automationId'|'revision'|'epoch'|'origin'|'actorId'>={definitionHash:hashValue({revision:definition.revision,payload}),configVersion:config.version,limitsHash:hashValue({policy,caps:config.caps,globalCaps:config.globalCaps}),context,product,productId:definition.productId,aiRoute,modules,maxItems:payload.dailyLimit,caps:config.caps,globalCaps:config.globalCaps,profiles:config.profiles,maxChargeUsd:Number(process.env.APIFY_MAX_CHARGE_USD??0),maxPages:Number(process.env.APOLLO_MAX_PAGES??0)};
 return {draft,input,usage:input?estimateUsage(input,aiRoute):[],blockers:[...new Set(blockers)]};
}
