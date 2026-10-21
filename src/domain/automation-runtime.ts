import type {PoolClient} from 'pg';
import type {Automation,CompanyProfile} from './model.ts';
import type {ScheduleV2} from './schedule.ts';
import type {ApprovedProduct} from './products.ts';
import type {AiRoute,AiRouteView} from './ai-routing.ts';
import type {ModuleId,Units,UsageEstimate,IngestCounts} from './prospecting.ts';
export interface AutomationDefinition{id:string;revision:number;payload:Automation;schedule:ScheduleV2|null;dependsOnAutomationId:string|null;qualificationCriteria:string|null;productId:string|null}
export interface AutomationRuntime{automationId:string;revision:number;definitionRevision:number;status:'paused'|'active'|'blocked';nextRunAt:string|null;lastRunAt:string|null;blockedCode:string|null;backlog:number}
export interface AutomationAuthorization{id:string;automationId:string;revision:number;epoch:number;origin:'schedule'|'manual';actorId:string;definitionHash:string;configVersion:string;limitsHash:string;context:CompanyProfile|null;product:ApprovedProduct|null;productId:string|null;aiRoute:AiRoute|null;modules:ModuleId[];maxItems:number;caps:Units;globalCaps:Units;profiles:Record<string,{actor:string;build:string}>;maxChargeUsd:number;maxPages:number}
export interface AutomationActionReview{token:string;expiresAt:string;action:'activate'|'run-once';expectedRevision:number;definition:AutomationDefinition;usage:UsageEstimate[];aiRoute:AiRouteView|null;effects:string[];blockers:string[]}
export interface SchedulerLease{workspaceId:string;automationId:string;actorId:string;token:string;fence:number;expiresAt:string}
export type OccurrenceState='empty'|'queued'|'waiting_dependency'|'running'|'completed'|'partial'|'failed'|'needs_reconciliation'|'cancelled'|'blocked';
export interface AutomationOccurrence{id:string;automationId:string;revision:number;origin:'schedule'|'manual';scheduledAt:string;state:OccurrenceState;jobId:string|null;skippedWindows:number;blockedCode:string|null;counts:IngestCounts}
export type LeadSelector=(c:PoolClient,definition:AutomationDefinition,occurrence:AutomationOccurrence,limit:number)=>Promise<string[]>;
