import 'server-only';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {JobInput,JobView,UsageEstimate,Units} from '../../domain/prospecting.ts';
import {reserveUsage} from './usage.ts';
import {usageUnits} from './config.ts';
import {jobView} from './repository.ts';

// Caller owns the transaction, workspace lock, authorization and replay check.
export async function insertReviewedJob(c:PoolClient,p:Principal,data:{requestId:string;listId:string|null;input:JobInput;bodyHash:string;profileVersion:string;checkpoint:Record<string,unknown>;usage:UsageEstimate[];caps:Units;globalCaps:Units}):Promise<JobView>{
 const id=randomUUID(),source=data.input.kind==='generation'?data.input.source:data.input.kind==='planning'?'AI':'QUALIFY';
 const row=(await c.query("INSERT INTO app.prospecting_job(workspace_id,id,actor_id,list_id,request_id,body_hash,kind,source,state,input,profile_version,checkpoint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued',$9,$10,$11) RETURNING *",[p.workspaceId,id,p.userId,data.listId,data.requestId,data.bodyHash,data.input.kind,source,data.input,data.profileVersion,data.checkpoint])).rows[0];
 await reserveUsage(c,{jobId:id,operationId:id,units:usageUnits(data.usage),caps:data.caps,globalCaps:data.globalCaps});
 return jobView(row);
}
