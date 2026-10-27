import type {PoolClient} from 'pg';
import type {ProspectingInput} from '../../domain/prospecting.ts';
import type {AiRoute} from '../../domain/ai-routing.ts';
import type {ProspectingConfig} from './config.ts';
import {normalizeCnpj} from './normalize.ts';import {hashValue} from './review.ts';import {AppError} from '../errors.ts';
import {ENRICHMENT_CONTRACT} from './ai/decisors.ts';
export interface EnrichmentGroup{cnpj:string;leadId:string;cacheId:string|null}
export interface EnrichmentCheckpoint{contract:string;groups:EnrichmentGroup[];reserveCredits:number;cached:number}
export async function enrichmentCheckpoint(c:PoolClient,input:Extract<ProspectingInput,{kind:'qualification'}>,bases:Record<string,any>,config:ProspectingConfig,route:AiRoute|null):Promise<EnrichmentCheckpoint|null>{
 if(!input.enrichment)return null;const unique=new Map<string,string>();
 for(const id of input.leadIds){const lead=bases[id],cnpj=normalizeCnpj(lead?.cnpj);if(!cnpj||lead.qualification!=='qualified')throw new AppError(422,'Selecione empresas qualificadas com CNPJ.');if(!unique.has(cnpj))unique.set(cnpj,id);}
 const contract=hashValue({contract:ENRICHMENT_CONTRACT,profiles:config.profiles,model:route?.conventional.model,provider:route?.conventional.provider,outputContract:route?.conventional.contractVersion,assessment:route?.decisionProvider==='jev'?'jev-contact-evidence-v1':null});
 const rows=(await c.query('SELECT DISTINCT ON(cnpj) cnpj,id FROM app.enrichment_resolution WHERE cnpj=ANY($1::text[]) AND contract=$2 AND expires_at>clock_timestamp() ORDER BY cnpj,resolved_at DESC,id DESC',[[...unique.keys()],contract])).rows;
 const cached=new Map(rows.map(r=>[r.cnpj,r.id])),groups=[...unique].map(([cnpj,leadId])=>({cnpj,leadId,cacheId:cached.get(cnpj)??null}));
 return{contract,groups,reserveCredits:Math.min(input.enrichment.maxCredits,groups.filter(g=>!g.cacheId).length),cached:cached.size};
}
