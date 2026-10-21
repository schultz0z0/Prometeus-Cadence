import {z} from 'zod';
import {isAbsolute} from 'node:path';
import {existsSync} from 'node:fs';
import type {GenerationSource,JobInput,Units,UsageEstimate} from '../../domain/prospecting.ts';
import {hashValue} from './review.ts';
import {providerProfile,actorInput} from './providers/profiles.ts';
import type {AiRoute} from '../../domain/ai-routing.ts';
const conventionalUnit=(p:string):import('../../domain/prospecting.ts').Unit=>p==='codex-local'?'codexCalls':p==='openai'?'openaiCalls':'geminiCalls';
const unitCaps=z.strictObject({candidates:z.number().int().min(0).max(1e9).default(0),apifyRuns:z.number().int().min(0).max(1e9).default(0),apolloPages:z.number().int().min(0).max(1e9).default(0),jevCalls:z.number().int().min(0).max(1e9).default(0),codexCalls:z.number().int().min(0).max(1e9).default(0),openaiCalls:z.number().int().min(0).max(1e9).default(0),geminiCalls:z.number().int().min(0).max(1e9).default(0)});
export function parseCaps(value:string|undefined){try{return unitCaps.parse(JSON.parse(value??'{}'));}catch{return unitCaps.parse({});}}
export function prospectingConfig(){
  const e=process.env;
  const profiles=Object.fromEntries(['MAPS','WEB','CNPJ'].map(s=>[s,{actor:e[`APIFY_${s}_ACTOR`]??'',build:e[`APIFY_${s}_BUILD`]??''}])) as Record<'MAPS'|'WEB'|'CNPJ',{actor:string;build:string}>;
  const caps=parseCaps(e.PROSPECTING_WORKSPACE_DAILY_UNITS), globalCaps=parseCaps(e.PROSPECTING_GLOBAL_DAILY_UNITS);
  let local=false;try{local=e.CADENCE_RUNTIME_MODE==='local'&&['127.0.0.1','localhost','[::1]'].includes(new URL(e.BETTER_AUTH_URL!).hostname);}catch{}
  const codexEnabled=e.CODEX_LOCAL_ENABLED==='true'&&local&&!!e.CODEX_BINARY&&isAbsolute(e.CODEX_BINARY)&&existsSync(e.CODEX_BINARY)&&!!e.CODEX_MODEL;
  const ready:Record<GenerationSource,boolean>={MAPS:false,WEB:false,CNPJ:false,APOLLO:!!e.APOLLO_API_KEY&&Number(e.APOLLO_MAX_PAGES)>0};
  for(const key of ['MAPS','WEB','CNPJ'] as const)ready[key]=!!e.APIFY_TOKEN&&!!profiles[key].actor&&!!profiles[key].build&&Number(e.APIFY_MAX_CHARGE_USD)>0;
  const codexWorkspaces=(e.CODEX_TEST_WORKSPACE_IDS??'').split(',').map(x=>x.trim()).filter(Boolean);
  const enabled=e.PROSPECTING_ENABLED==='true';
  const version=hashValue({enabled,profiles,ready,caps,globalCaps,apifyMax:e.APIFY_MAX_CHARGE_USD,apolloMax:e.APOLLO_MAX_PAGES,jev:e.JEV_MODEL??'typesafe/jev-1.13',jevReady:!!e.OPENROUTER_API_KEY,codexEnabled,codexWorkspaces,codexModel:e.CODEX_MODEL,credentials:hashValue([e.APIFY_TOKEN??'',e.APOLLO_API_KEY??'',e.OPENROUTER_API_KEY??''])});
  return {enabled,profiles,ready,caps,globalCaps,version,codexEnabled,codexWorkspaces,jevReady:!!e.OPENROUTER_API_KEY&&(e.JEV_MODEL??'typesafe/jev-1.13')==='typesafe/jev-1.13'};
}
export type ProspectingConfig=ReturnType<typeof prospectingConfig>;
export function estimateUsage(input:JobInput,route?:AiRoute|null):UsageEstimate[]{
  const result:UsageEstimate[]=[];
  const add=(provider:string,unit:UsageEstimate['unit'],maxUnits:number)=>result.push({provider,unit,maxUnits,estimatedUsd:null,pricingSource:null});
  if(input.kind==='generation'){
    add(input.source==='APOLLO'?'apollo':'apify','candidates',input.limit);
    add(input.source==='APOLLO'?'apollo':'apify',input.source==='APOLLO'?'apolloPages':'apifyRuns',input.source==='APOLLO'?Math.ceil(input.limit/100):1);
  }else if(input.kind==='planning'){
    if(route){
      add(route.conventional.provider,conventionalUnit(route.conventional.provider),1);
      if(['audience_plan','cadence_options'].includes(input.task)&&route.decisionProvider==='jev')add('openrouter','jevCalls',1);
    }
  }else{
    const n=input.leadIds.length;
    if(input.modules.includes('qualify')){if(!route||route.decisionProvider==='jev')add('openrouter','jevCalls',n);else add(route.conventional.provider,conventionalUnit(route.conventional.provider),n);}
    const calls=(input.modules.includes('summary')?n:0)+(input.escalation==='ambiguous'&&input.modules.includes('qualify')&&(!route||route.decisionProvider==='jev')?n:0);
    if(calls)add(route?.conventional.provider??'codex',route?conventionalUnit(route.conventional.provider):'codexCalls',calls);
    if(input.modules.includes('registry'))add('apify','apifyRuns',n);
    if(input.modules.includes('website'))add('apify','apifyRuns',n);
  }
  return result;
}
export const usageUnits=(usage:UsageEstimate[]):Units=>Object.fromEntries(usage.map(u=>u.unit).map(k=>[k,usage.filter(u=>u.unit===k).reduce((n,u)=>n+u.maxUnits,0)]));
export function requirements(config:ProspectingConfig,input:JobInput,workspaceId:string,route?:AiRoute|null){
  const blockers:string[]=[];
  if(!config.enabled)blockers.push('As execuções externas ainda não foram habilitadas neste ambiente.');
  if(input.kind==='generation'&&!config.ready[input.source])blockers.push('Configure a credencial e o perfil da fonte antes de executar.');
  if(input.kind==='generation'){
    if(input.source==='APOLLO'&&Object.entries(input.filters).some(([k,v])=>v&&!['term','location'].includes(k)))blockers.push('Este perfil Apollo aceita público e localização; os demais filtros ainda não têm contrato habilitado.');
    if(input.source!=='APOLLO')try{actorInput(providerProfile(input.source,config.profiles[input.source]),input);}catch{blockers.push(input.source==='CNPJ'?'O perfil ou os filtros cadastrais não estão disponíveis. Informe um CNAE ou CNPJ suportado.':'O perfil de busca ainda não está disponível. Configure um Actor/build verificado.');}
  }
  if(input.kind==='qualification'){


    if(input.modules.includes('registry')&&!config.ready.CNPJ)blockers.push('Configure a consulta cadastral.');
    if(input.modules.includes('website')&&!config.ready.WEB)blockers.push('Configure a busca de sites.');
  }
  for(const u of estimateUsage(input,route))if(u.maxUnits>(config.caps[u.unit]??0)||u.maxUnits>(config.globalCaps[u.unit]??0))blockers.push(`O limite de ${u.unit} não permite esta execução.`);
  return blockers;
}
