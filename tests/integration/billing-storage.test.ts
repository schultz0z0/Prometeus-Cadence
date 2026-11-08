import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {billingUser,beginTrial,creditFixture,testAdmin} from './billing-helpers.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {getPools} from '../../src/server/db/pool.ts';
import {readBilling,startTrial} from '../../src/server/billing/repository.ts';
import {readExtractionDay} from '../../src/server/billing/extraction-day.ts';
import {readQualificationDay} from '../../src/server/billing/qualification-day.ts';
import {workspaceProspectingConfig} from '../../src/server/prospecting/workspace-config.ts';
after(()=>getPools().close());
test('new workspaces have no subscription; owner trial is exactly seven days and cannot restart',async()=>{
 const u=await billingUser();
 const exists=await testAdmin(async c=>(await c.query("SELECT to_regclass('app.billing_account') AS table_name")).rows[0].table_name);assert.ok(exists,'billing storage must exist');
 const initial=await withWorkspaceTransaction(u.p,async c=>(await c.query('SELECT state FROM app.billing_account')).rows[0]);assert.equal(initial.state,'inactive');
 const key=randomUUID(),trial=await beginTrial(u.p,key);assert.equal(trial.state,'trial');
 assert.equal(Date.parse(trial.period_end)-Date.parse(trial.period_start),7*86400000);
 assert.deepEqual(await beginTrial(u.p,key),trial);await assert.rejects(beginTrial(u.p),{code:'TRIAL_ALREADY_USED'});
});
test('billing rows are tenant isolated and app SQL cannot mint credit or rewrite account status',async()=>{
 const a=await billingUser(),b=await billingUser();await beginTrial(a.p);
 await withWorkspaceTransaction(b.p,async c=>{
  assert.equal((await c.query('SELECT * FROM app.billing_account WHERE workspace_id=$1',[a.p.workspaceId])).rowCount,0);
  assert.equal((await c.query("SELECT has_table_privilege(current_user,'app.billing_grant','INSERT') AS allowed")).rows[0].allowed,false);
  assert.equal((await c.query("SELECT has_table_privilege(current_user,'app.billing_account','UPDATE') AS allowed")).rows[0].allowed,false);
 });
});
test('operator cannot start trial even with a stale owner principal',async()=>{
 const u=await billingUser();await testAdmin(c=>c.query('UPDATE auth.member SET role=$1 WHERE "organizationId"=$2 AND "userId"=$3',['operator',u.p.workspaceId,u.p.userId]));
 await assert.rejects(beginTrial(u.p),/FORBIDDEN/);
});
test('billing view reports actual remaining credit and never exposes Stripe credentials',async()=>{
 const u=await billingUser();await startTrial(u.p,randomUUID());const view=await readBilling(u.p);
 assert.equal(view.status,'trial');assert.equal(view.canManage,true);assert.equal(view.balances.find(b=>b.unit==='imports')?.plan,5000);
 assert.equal(JSON.stringify(view).includes('sk_test_'),false);assert.equal(view.capacity?.seats,2);assert.equal(view.usage.seats,1);
});
test('paid generation enforces separate daily limits and allocates only the selected balance',async()=>{
 const {p}=await billingUser(),listId=randomUUID();
 await testAdmin(async c=>{
  await c.query("UPDATE app.billing_account SET state='active',plan='essential',period_start=now()-interval '1 day',period_end=now()+interval '29 days' WHERE workspace_id=$1",[p.workspaceId]);
  await c.query('INSERT INTO app.list(workspace_id,id,name) VALUES($1,$2,$3)',[p.workspaceId,listId,'[RE] Franquia']);
 });
 const plan=await creditFixture(p.workspaceId,'extractions',5000,'plan',new Date(Date.now()+29*86400000).toISOString());
 const pack=await creditFixture(p.workspaceId,'extractions',2000);
 const reserve=(limit:number,funding?:string)=>withWorkspaceTransaction(p,async c=>{
  const id=randomUUID();
  await c.query("INSERT INTO app.prospecting_job(workspace_id,id,actor_id,list_id,request_id,body_hash,kind,source,state,input,profile_version) VALUES($1,$2,$3,$4,$2,'fixture','generation','MAPS','queued',$5,'fixture')",[p.workspaceId,id,p.userId,listId,{limit,...(funding?{funding}:{})}]);
  return id;
 });
 const attempts=await Promise.allSettled([reserve(200),reserve(200)]);
 assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(attempts.find(result=>result.status==='rejected')?.reason.code,'BILLING_DAILY_LIMIT');
 const included=attempts.find(result=>result.status==='fulfilled')!.value;
 const prepaid=await reserve(250,'credits');
 await assert.rejects(reserve(1,'credits'),{code:'BILLING_DAILY_LIMIT'});
 await withWorkspaceTransaction(p,async c=>{
  assert.deepEqual(await readExtractionDay(c),{limit:250,plan:200,credits:250,creditsBalance:1750,planBalance:4800});
  const rows=(await c.query('SELECT key,grant_id,held FROM app.billing_allocation ORDER BY held')).rows;
  assert.deepEqual(rows,[{key:'job:'+included,grant_id:plan,held:200},{key:'job:'+prepaid,grant_id:pack,held:250}]);
  await c.query('SELECT app.billing_release($1)',['job:'+included]);
 });
 await reserve(250);
 await testAdmin(c=>c.query("UPDATE app.billing_account SET plan='pro' WHERE workspace_id=$1",[p.workspaceId]));
 await reserve(150);
 await reserve(150,'credits');
 await assert.rejects(reserve(1),{code:'BILLING_DAILY_LIMIT'});
 assert.equal((await readBilling(p)).dailyExtractions?.limit,400);
});
test('qualification keeps separate daily capacity and releases leads skipped or left unprocessed',async()=>{
 const {p}=await billingUser(),listId=randomUUID(),ids=Array.from({length:251},()=>randomUUID());
 const creditLead=ids[250],discovery=randomUUID();
 await testAdmin(async c=>{
  await c.query("UPDATE app.billing_account SET state='active',plan='essential',period_start=now()-interval '1 day',period_end=now()+interval '29 days' WHERE workspace_id=$1",[p.workspaceId]);
  await c.query('INSERT INTO app.list(workspace_id,id,name) VALUES($1,$2,$3)',[p.workspaceId,listId,'[RE] Qualificação']);
  await c.query("INSERT INTO app.lead(workspace_id,id,list_id,payload) SELECT $1,lead,$2,jsonb_build_object('name','[RE] Empresa') FROM unnest($3::text[]) lead",[p.workspaceId,listId,ids]);
  await c.query("INSERT INTO app.prospecting_job(workspace_id,id,actor_id,list_id,request_id,body_hash,kind,source,state,input,profile_version) VALUES($1,$2,$3,$4,$2,'fixture','generation','MAPS','completed','{}','fixture')",[p.workspaceId,discovery,p.userId,listId]);
  await c.query("INSERT INTO app.billing_reservation(workspace_id,key,unit,quantity,closed,funding,local_day) VALUES($1,$2,'extractions',1,true,'credits',(now() AT TIME ZONE 'America/Sao_Paulo')::date)",[p.workspaceId,'job:'+discovery]);
  await c.query("INSERT INTO app.prospecting_item(workspace_id,job_id,id,lead_id,name,status) VALUES($1,$2,$3,$4,'[RE] Adicional','inserted')",[p.workspaceId,discovery,randomUUID(),creditLead]);
 });
 const reserve=(leadIds:string[])=>withWorkspaceTransaction(p,async c=>{
  const id=randomUUID();
  await c.query("INSERT INTO app.prospecting_job(workspace_id,id,actor_id,list_id,request_id,body_hash,kind,source,state,input,profile_version) VALUES($1,$2,$3,$4,$2,'fixture','qualification','QUALIFY','queued',$5,'fixture')",[p.workspaceId,id,p.userId,listId,{leadIds,modules:['email']}]);
  return id;
 });
 const included=ids.slice(0,250);
 const attempts=await Promise.allSettled([reserve(included),reserve(included)]);
 assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(attempts.find(result=>result.status==='rejected')?.reason.code,'BILLING_QUALIFICATION_DAILY_LIMIT');
 const job=attempts.find(result=>result.status==='fulfilled')!.value;
 await reserve([creditLead]);
 assert.deepEqual(await withWorkspaceTransaction(p,c=>readQualificationDay(c,listId,[included[0],creditLead])),
  {limit:250,plan:250,credits:1,requestedPlan:1,requestedCredits:1});
 await testAdmin(async c=>{
  for(const [leadId,status,reason] of [[included[0],'pending_review',''],[included[1],'skipped','NO_SITE']]){
   await c.query("INSERT INTO app.prospecting_item(workspace_id,job_id,id,lead_id,name,status,payload) VALUES($1,$2,$3,$4,'[RE] Empresa','pending_review',$5)",[p.workspaceId,job,randomUUID(),leadId,{results:[{status,reasons:[reason]}]}]);
  }
  await c.query("UPDATE app.prospecting_job SET state='partial' WHERE workspace_id=$1 AND id=$2",[p.workspaceId,job]);
 });
 await assert.rejects(reserve(included),{code:'BILLING_QUALIFICATION_DAILY_LIMIT'});
 await reserve(included.slice(1));
 assert.equal((await readBilling(p)).dailyQualifications?.plan,250);
});
test('paid technical budgets support every module and keep audience suggestions outside qualification capacity',async()=>{
 const {p}=await billingUser(),listId=randomUUID();
 await testAdmin(async c=>{
  await c.query("UPDATE app.billing_account SET state='active',plan='essential',period_start=now(),period_end=now()+interval '30 days' WHERE workspace_id=$1",[p.workspaceId]);
  await c.query('INSERT INTO app.list(workspace_id,id,name) VALUES($1,$2,$3)',[p.workspaceId,listId,'[RE] Capacidade']);
 });
 const config=await withWorkspaceTransaction(p,workspaceProspectingConfig);
 assert.ok(config.config.caps.codexCalls>=2000);
 assert.ok(config.config.caps.apifyRuns>=10000);
 const reserve=(kind:string,units:Record<string,number>)=>withWorkspaceTransaction(p,async c=>{
  const id=randomUUID();await c.query("INSERT INTO app.prospecting_job(workspace_id,id,actor_id,list_id,request_id,body_hash,kind,source,state,input,profile_version) VALUES($1,$2,$3,$4,$2,'fixture',$5,'AI','queued','{}','fixture')",[p.workspaceId,id,p.userId,listId,kind]);
  await c.query("SELECT app.reserve_prospecting_usage($1,$1,$2,'{}','{}')",[id,units]);
  await c.query("INSERT INTO app.usage_ledger(workspace_id,job_id,operation_id,event,units) VALUES($1,$2,$2,'consume',$3),($1,$2,$2,'release',$3)",[p.workspaceId,id,units]);
 });
 await reserve('planning',{codexCalls:20});
 await assert.rejects(reserve('planning',{codexCalls:1}),/PLANNING_DAILY_LIMIT/);
 // Both modalities at 250/day, unit searches: 2 Maps starts + 2 candidates × 8
 // admission runs, then company(3), people(3), qualification(2) per delivery.
 for(let modality=0;modality<2;modality++){
  await reserve('qualification',{apifyRuns:18*250});
  await reserve('qualification',{apifyRuns:8*250,codexCalls:4*250});
 }
 await assert.rejects(reserve('qualification',{codexCalls:1}),/USAGE_WORKSPACE_LIMIT/);
 await testAdmin(c=>c.query("UPDATE app.billing_account SET plan='pro' WHERE workspace_id=$1",[p.workspaceId]));
 for(let modality=0;modality<2;modality++){
  await reserve('qualification',{apifyRuns:18*150});
  await reserve('qualification',{apifyRuns:8*150,codexCalls:4*150});
 }
 await assert.rejects(reserve('qualification',{apifyRuns:1}),/USAGE_WORKSPACE_LIMIT/);
 await testAdmin(c=>c.query('INSERT INTO app.prospecting_policy(workspace_id,limits) VALUES($1,$2)',[p.workspaceId,{geminiCalls:2}]));
 await reserve('qualification',{geminiCalls:2});
 await assert.rejects(reserve('qualification',{geminiCalls:1}),/USAGE_WORKSPACE_LIMIT/);
 const trial=(await billingUser()).p;
 await withWorkspaceTransaction(trial,async c=>{
  const id=randomUUID();
  await c.query('SELECT app.billing_start_trial($1)',[randomUUID()]);
  await c.query("INSERT INTO app.prospecting_job(workspace_id,id,actor_id,request_id,body_hash,kind,source,state,input,profile_version) VALUES($1,$2,$3,$2,'fixture','planning','AI','queued','{}','fixture')",[trial.workspaceId,id,trial.userId]);
  await c.query("SELECT app.reserve_prospecting_usage($1,$1,'{\"apifyRuns\":1}','{\"apifyRuns\":1}','{\"apifyRuns\":10000}')",[id]);
 });
});
