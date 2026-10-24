import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {billingUser,testAdmin} from './billing-helpers.ts';
import {getPools} from '../../src/server/db/pool.ts';
import {closeBillingPool} from '../../src/server/billing/db.ts';
import {billingRequest,billingWebhook} from '../../src/server/billing/http.ts';
import {base} from './helpers.ts';
after(async()=>{await closeBillingPool();await getPools().close();});
function request(u:any,action:string,body?:unknown,headers:Record<string,string>={}){return new Request(base+'/api/billing/'+action,{method:body===undefined?'GET':'POST',headers:{cookie:u.cookie,origin:base,'x-cadence-workspace':u.p.workspaceId,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});}
test('billing HTTP requires session, expected workspace, origin and exact method',async()=>{
 const u=await billingUser();assert.equal((await billingRequest(new Request(base+'/api/billing'),'read')).status,401);
 assert.equal((await billingRequest(request(u,'',{},{origin:'https://other.example'}),'trial')).status,403);
 assert.equal((await billingRequest(request(u,'',undefined,{'x-cadence-workspace':'other'}),'read')).status,409);
 assert.equal((await billingRequest(request(u,'trial'),'trial')).status,405);
 const r=await billingRequest(request(u,''),'read');assert.equal(r.status,200);const data=await r.json();assert.equal(data.status,'inactive');assert.equal(JSON.stringify(data).includes('sk_test_'),false);
 const trial=await billingRequest(request(u,'trial',{requestId:randomUUID()}),'trial');assert.equal(trial.status,200);assert.equal((await trial.json()).status,'trial');
});
test('current operator cannot activate trial or contact update even with an old administrative session',async()=>{
 const u=await billingUser();await testAdmin(c=>c.query('UPDATE auth.member SET role=\'operator\' WHERE "organizationId"=$1 AND "userId"=$2',[u.p.workspaceId,u.p.userId]));
 assert.equal((await billingRequest(request(u,'trial',{requestId:randomUUID()}),'trial')).status,403);
 assert.equal((await billingRequest(request(u,'contact',{requestId:randomUUID(),expectedRevision:0,email:'qa@example.com',phone:null}),'contact')).status,403);
});
test('oversized JSON and unsigned webhook are rejected without state mutation',async()=>{
 const u=await billingUser();assert.equal((await billingRequest(request(u,'prepare',{padding:'x'.repeat(70000)}),'prepare')).status,413);
 assert.equal((await billingWebhook(new Request(base+'/api/billing/webhook',{method:'POST',body:'{}'}))).status,400);
 assert.equal((await billingRequest(request(u,'prepare',{kind:'checkout',sku:'essential',amount:1}),'prepare')).status,422);
});
