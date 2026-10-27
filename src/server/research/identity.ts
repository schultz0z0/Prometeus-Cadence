import 'server-only';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {Lead} from '../../domain/model.ts';
import type {AiRoute} from '../../domain/ai-routing.ts';
import type {ProspectingInput} from '../../domain/prospecting.ts';
import type {ProspectingConfig} from '../prospecting/config.ts';
import type {CompanyIdentity} from '../../domain/company-people.ts';
import {peopleContractVersion} from '../../domain/company-people.ts';
import {researchLeadBasis} from '../../domain/company-research.ts';
import {AI_SKILLS_VERSION} from '../../domain/ai-skills.ts';
import {hashValue} from '../prospecting/review.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
export function companyPeopleKey(lead:Lead){const {id:_id,listId:_list,...basis}=researchLeadBasis(lead);return hashValue(basis);}
export async function reusablePeople(c:PoolClient,key:string,contract:string){return (await c.query(`SELECT i.* FROM app.research_company_identity i JOIN app.research_case r ON r.workspace_id=i.workspace_id AND r.id=i.case_id
 WHERE i.identity_key=$1 AND i.contract=$2 AND i.expires_at>clock_timestamp() AND r.state<>'pending'
 AND (i.state<>'resolved' OR app.people_evidence_valid(i.workspace_id,i.job_id,i.lead_id,i.evidence))
 AND NOT EXISTS(SELECT 1 FROM app.research_person p WHERE p.workspace_id=i.workspace_id AND p.case_id=i.case_id AND NOT app.people_evidence_valid(i.workspace_id,i.job_id,i.lead_id,p.evidence))
 AND NOT EXISTS(SELECT 1 FROM app.research_person_contact pc WHERE pc.workspace_id=i.workspace_id AND pc.case_id=i.case_id AND NOT app.people_evidence_valid(i.workspace_id,i.job_id,i.lead_id,pc.evidence))
 ORDER BY i.created_at DESC,i.case_id DESC LIMIT 1`,[key,contract])).rows[0]??null;}
export async function peopleCheckpoint(c:PoolClient,input:Extract<ProspectingInput,{kind:'qualification'}>,bases:Record<string,any>,config:ProspectingConfig,route:AiRoute|null,context:Record<string,unknown>|null){
 const contract=hashValue({contract:peopleContractVersion,skills:AI_SKILLS_VERSION,profiles:config.profiles,route:route?.conventional,assessment:route?.decisionProvider,context:context?.version??0});
 const groups=[];for(const leadId of input.leadIds){const identityKey=companyPeopleKey(bases[leadId]),cache=await reusablePeople(c,identityKey,contract);groups.push({leadId,cnpj:identityKey,identityKey,cacheId:cache?.case_id??null});}
 return{contract,groups,reserveCredits:Math.min(input.enrichment!.maxCredits,groups.filter(g=>!g.cacheId).length),cached:groups.filter(g=>g.cacheId).length};
}
export async function resolveCompanyIdentity(p:Principal,caseId:string):Promise<CompanyIdentity>{return withWorkspaceTransaction(p,async c=>{
 const r=(await c.query('SELECT * FROM app.research_company_identity WHERE case_id=$1 OR job_id=$1 ORDER BY lead_id LIMIT 1',[caseId])).rows[0];if(!r)throw new AppError(404,'Identidade empresarial não encontrada.');return{caseId:r.case_id,cnpj:r.cnpj,legalName:r.legal_name,state:r.state,evidence:r.evidence};
});}
