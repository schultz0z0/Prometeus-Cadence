import type {AudiencePlan,CadenceStep,CompanyProfile,Schedule} from './model.ts';
import type {GenerationSource,ModuleId,Review} from './prospecting.ts';
export type PlanningInput=
 |{kind:'planning';task:'context_read';domain:string;target:{kind:'company'}|{kind:'product';productId:string}}
 |{kind:'planning';task:'audience_plan';description:string;channel:'email'|'whatsapp'|'both';productId?:string;timezone:string}
 |{kind:'planning';task:'cadence_options';listId:string;objective:string;channels:('EMAIL'|'WHATSAPP')[];tone:string;rhythm:string;highlight:string;avoid:string;decisionMaker:string;productId?:string}
 |{kind:'planning';task:'message_preview';cadenceId:string;stepId:string;leadId:string;productId?:string;variant?:'A'|'B'};
export type PlanningTask=PlanningInput['task'];
export const planningTaskLabels:Record<PlanningTask,string>={context_read:'Leitura de contexto',audience_plan:'Propostas de público',cadence_options:'Opções de cadência',message_preview:'Prévia para um lead'};
export const contextFields=['name','offer','products','idealCustomer','pains','differentiators','competitors','socialProof','sources'] as const satisfies readonly (keyof CompanyProfile)[];
export type ContextField=typeof contextFields[number];
export interface SupportedField{value:string;evidenceIds:string[];quote:string}
export interface PlanningEvidence{id:string;kind:'public_page'|'approved_context'|'user_brief'|'lead_fact';url:string|null;text:string;hash:string;obtainedAt:string}
export interface AudienceOption extends Omit<AudiencePlan,'source'|'marketSize'>{source:GenerationSource;marketSize:null;modules:ModuleId[];criteria:string;schedules:{search:Schedule;qualification:Schedule}}
export interface CadenceOption{id:string;name:string;description:string;steps:Omit<CadenceStep,'id'>[]}
export type PlanningOption=AudienceOption|CadenceOption;
export interface PlanningBase{contextVersion:number;productVersion:number|null;workspaceRevision:number}
export type PlanningResult=
 |{task:'context_read';fields:Partial<Record<ContextField,SupportedField>>}
 |{task:'audience_plan';options:AudienceOption[]}
 |{task:'cadence_options';options:CadenceOption[]}
 |{task:'message_preview';body:string;subject?:string;evidenceIds:string[]};
export type PlanningProposal=PlanningResult&{contractVersion:'planning-v1';jobId:string;base:PlanningBase;evidenceIds:string[];recommendedOptionId:string|null};
export interface PlanningReview extends Review<PlanningInput>{base:PlanningBase;productId:string|null}
export interface PlanningSelectionReview{optionId:string;edits:unknown;token:string;expiresAt:string;effects:string[];blockers:string[]}
