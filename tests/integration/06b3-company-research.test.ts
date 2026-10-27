import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {configureProspectingTest,prospectingUser,closeProspectingPools,testAdmin} from './prospecting-helpers.ts';
import {resetRateLimits} from './helpers.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
configureProspectingTest();beforeEach(resetRateLimits);after(closeProspectingPools);

test('research storage is private and application users cannot forge worker facts',async()=>{
 const {p}=await prospectingUser();
 assert.deepEqual(await withWorkspaceTransaction(p,async c=>(await c.query('SELECT id FROM app.research_case')).rows),[]);
 await assert.rejects(withWorkspaceTransaction(p,c=>c.query("INSERT INTO app.research_fact(workspace_id,job_id,id,lead_id,field,value,evidence,attribution) VALUES($1,'missing',$2,'missing','email','forged@example.com','[]','company')",[p.workspaceId,randomUUID()])),/permission denied/i);
 const rows=await testAdmin(c=>c.query('SELECT id FROM app.research_case WHERE workspace_id=$1',[p.workspaceId]));assert.equal(rows.rowCount,0);
});
