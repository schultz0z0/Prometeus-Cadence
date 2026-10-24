import {randomUUID} from 'node:crypto';
import {prospectingUser,testAdmin} from './prospecting-helpers.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {resetRateLimits} from './helpers.ts';
export {testAdmin};
export async function billingUser(){await resetRateLimits();return prospectingUser({billing:false});}
export async function beginTrial(p:import('../../src/domain/workspace.ts').Principal,key=randomUUID()){
 return withWorkspaceTransaction(p,async c=>(await c.query('SELECT app.billing_start_trial($1) AS result',[key])).rows[0].result);
}
export async function creditFixture(ws:string,unit:string,amount:number,source='pack',expires:string|null=null){
 const id=randomUUID();await testAdmin(c=>c.query('INSERT INTO app.billing_grant(workspace_id,id,unit,quantity,source,external_ref,expires_at) VALUES($1,$2,$3,$4,$5,$2,$6)',[ws,id,unit,amount,source,expires]));return id;
}
