import type { Lead } from './model.ts';
export type JobState='queued'|'running'|'waiting_provider'|'needs_reconciliation'|'cancelling'|'cancelled'|'completed'|'partial'|'failed';
export type ModuleId='email'|'phone'|'website'|'summary'|'deep'|'validateEmail'|'registry'|'qualify';
export type GenerationSource='MAPS'|'WEB'|'CNPJ'|'APOLLO';
export type Destination={mode:'new';name:string}|{mode:'existing';listId:string};
export type JobInput={kind:'generation';source:GenerationSource;destination:Destination;filters:Record<string,string>;limit:number;dedupScope:'list'|'workspace'}|{kind:'qualification';listId:string;leadIds:string[];modules:ModuleId[];summaryPolicy:'all'|'fits';escalation:'off'|'ambiguous'};
export type Unit='candidates'|'apifyRuns'|'apolloPages'|'jevCalls'|'codexCalls';
export type Units=Partial<Record<Unit,number>>;
export interface UsageEstimate{provider:string;unit:Unit;maxUnits:number;estimatedUsd:number|null;pricingSource:string|null}
export interface ProviderUsage{provider:string;operationId:string;units:Units;inputTokens?:number;outputTokens?:number;fetchedCount?:number;acceptedCount?:number;costUsd:number|null;costKind:'reported'|'estimated'|'unknown'}
export interface Review{token:string;expiresAt:string;input:JobInput;warnings:string[];blockers:string[];profileVersion:string;usage:UsageEstimate[]}
export interface JobLease{workspaceId:string;jobId:string;actorId:string;token:string;expiresAt:string;fence:number}
export interface IngestCounts{found:number;inserted:number;duplicates:number;rejected:number;pending:number}
export interface JobView{id:string;kind:JobInput['kind'];source:GenerationSource|'QUALIFY';state:JobState;listId:string;createdBy:string;createdAt:string;updatedAt:string;revision:number;counts:IngestCounts;error:{code:string;message:string}|null;usage?:ProviderUsage[];testFixture?:boolean;unresolvedAttempts?:{id:string;provider:string;step:string;canAttachRun:boolean}[]}
export interface ProviderCapabilities{enabled:boolean;sources:Record<GenerationSource,{configured:boolean}>;decision:{model:string;configured:boolean};generation:{provider:string;configured:boolean};limits:{perJob:number;pageSize:number}}
export interface Page<T>{items:T[];nextCursor:string|null}
export interface Evidence{id:string;url:string;fetchedAt:string;text:string;hash:string;truncated:boolean}
export interface Candidate extends Omit<Lead,'id'|'listId'|'createdAt'|'qualification'>{sourceRef:string;facts?:Record<string,unknown>;contacts?:{emails:string[];phones:string[]};evidence?:Evidence[]}
export interface CandidatePage{receiptId:string;candidates:Candidate[];nextCursor:string|null;exhausted:boolean;rawCount:number;rejected:{sourceRef?:string;reason:string}[];usage:ProviderUsage}
export interface RemoteRun{provider:'apify';runId:string;datasetId:string|null;profileId:string;build:string;operationId:string}
export interface RemoteState{run:RemoteRun;status:'ready'|'running'|'succeeded'|'failed'|'cancelling'|'cancelled';error?:{code:string;message:string}}
export interface Decision{model:'typesafe/jev-1.13';verdict:'fits'|'does_not_fit'|'insufficient_evidence';confidence:number|null;probabilities:Record<string,number>;criteria:Record<string,number>;evidenceIds:string[];usage:ProviderUsage}
export interface Generation{model:string;summary:string;evidenceIds:string[];usage:ProviderUsage}
export interface ModuleResult{module:ModuleId;status:'succeeded'|'skipped'|'failed'|'pending_review';proposed:Partial<Lead>;base:Partial<Lead>;reasons:string[];evidenceIds:string[];usage:ProviderUsage|null;decision?:Decision;contextVersion?:number}
export interface JobItemView{id:string;leadId:string|null;sourceRef:string|null;name:string;status:string;results:ModuleResult[];applied:boolean;evidence?:Pick<Evidence,'id'|'url'|'fetchedAt'|'truncated'>[]}
export const terminalJobStates:JobState[]=['cancelled','completed','partial','failed'];
