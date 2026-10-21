import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {configureProspectingTest,prospectingUser,testAdmin} from './prospecting-helpers.ts';
import {executeWorkspaceCommand,readWorkspaceSnapshot} from '../../src/server/workspaces/commands.ts';
import {prepareAutomationAction,confirmAutomationAction} from '../../src/server/automations/authorization.ts';
import {readAutomationRuntime} from '../../src/server/automations/repository.ts';
import {withContextTransaction} from '../../src/server/db/transaction.ts';
import {lockWorkspace} from '../../src/server/prospecting/ingestion.ts';
import {workerPool} from '../../src/server/prospecting/worker-db.ts';
import type {SchedulerLease} from '../../src/domain/automation-runtime.ts';
import type {Principal} from '../../src/domain/workspace.ts';
export async function automationFixture(){
 configureProspectingTest();const {p,headers}=await prospectingUser();const s=await readWorkspaceSnapshot(p),id=randomUUID(),listId=randomUUID();
 await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'automation.save',list:{id:listId,name:'Scheduler QA'},automation:{id,listId,name:'Buscar QA',description:'Fixture local',source:'MAPS',status:'active',schedule:{frequency:'daily',time:'07:00',timezone:'UTC',weekdays:[0,1,2,3,4,5,6],anchorDate:'2026-01-01'},dailyLimit:5,filters:{term:'clínicas',location:'São Paulo'},modules:[],createdAt:new Date().toISOString()}}});
 return {p,id,listId,headers};
}
export async function activate(p:Principal,id:string){const runtime=await readAutomationRuntime(p,id),review=await prepareAutomationAction(p,id,{action:'activate',expectedRevision:runtime.revision});assert.deepEqual(review.blockers,[]);return confirmAutomationAction(p,id,{requestId:randomUUID(),action:'activate',expectedRevision:runtime.revision,reviewToken:review.token});}
export async function dueLease(p:Principal,id:string):Promise<SchedulerLease>{
 await testAdmin(c=>c.query("UPDATE app.automation_runtime SET next_run_at=date_trunc('day',clock_timestamp())-interval '2 days'+interval '7 hours',retry_at=NULL WHERE workspace_id=$1 AND automation_id=$2",[p.workspaceId,id]));
 const row=(await workerPool().query('SELECT * FROM app.claim_due_automation($1,$2)',[randomUUID(),p.workspaceId])).rows[0];assert.ok(row);
 return {workspaceId:row.workspace_id,automationId:row.automation_id,actorId:row.actor_id,token:row.token,fence:Number(row.fence),expiresAt:row.expires_at.toISOString()};
}
export function schedulerTransaction<T>(p:Principal,fn:Parameters<typeof withContextTransaction<T>>[2]){return withContextTransaction(workerPool(),p,async c=>{await lockWorkspace(c);return fn(c);});}
