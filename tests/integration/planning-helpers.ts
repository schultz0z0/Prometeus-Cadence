import {randomUUID} from 'node:crypto';
import {prospectingUser,configureProspectingTest} from './prospecting-helpers.ts';
import {insertReviewedJob} from '../../src/server/prospecting/job-store.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {hashValue} from '../../src/server/prospecting/review.ts';
import type {Principal} from '../../src/domain/workspace.ts';
export async function createPlanningFixture(){configureProspectingTest();const {p,headers}=await prospectingUser();return {p,headers};}
export async function planningStorageJob(p:Principal){
  const input={kind:'planning' as const,task:'context_read' as const,domain:'example.com',target:{kind:'company' as const}};
  return withWorkspaceTransaction(p,async c=>{
    await c.query('INSERT INTO app.workspace_meta(workspace_id) VALUES($1) ON CONFLICT DO NOTHING',[p.workspaceId]);
    await c.query('SELECT revision FROM app.workspace_meta WHERE workspace_id=$1 FOR UPDATE',[p.workspaceId]);
    return insertReviewedJob(c,p,{input,requestId:randomUUID(),bodyHash:hashValue(input),listId:null,profileVersion:'fixture',checkpoint:{},usage:[],caps:{},globalCaps:{}});
  });
}
