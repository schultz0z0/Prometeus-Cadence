import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {prospectingUser,configureProspectingTest,closeProspectingPools,grantTestLease,testAdmin} from './prospecting-helpers.ts';
import {saveAiPolicy} from '../../src/server/prospecting/ai/settings.ts';import {preparePlanning,confirmPlanning,getPlanning} from '../../src/server/planning/service.ts';import {runPlanning} from '../../src/server/planning/execution.ts';import {generatePlanning} from '../../src/server/planning/model.ts';
import {readWorkspaceSnapshot,executeWorkspaceCommand} from '../../src/server/workspaces/commands.ts';import {workerPool} from '../../src/server/prospecting/worker-db.ts';import {audienceResult} from '../planning-fixtures.ts';import {AI_SKILLS_VERSION} from '../../src/domain/ai-skills.ts';
configureProspectingTest();after(async()=>{await closeProspectingPools();await workerPool().end();});
test('two customers share one model while actual provider requests keep frozen company context, current intent and usage tenant-private',async()=>{
 const admin=await prospectingUser({platformAi:true}),a=await prospectingUser(),b=await prospectingUser();Object.assign(process.env,{OPENAI_API_KEY:'fixture',OPENAI_MODEL:'fixture',PROSPECTING_WORKSPACE_DAILY_UNITS:'{"openaiCalls":10}',PROSPECTING_GLOBAL_DAILY_UNITS:'{"openaiCalls":100000}'});
 await saveAiPolicy(admin.p,{requestId:randomUUID(),expectedRevision:0,policy:{mode:'conventional-only',conventionalProvider:'openai',jevEnabled:false}});
 const request={kind:'planning' as const,task:'audience_plan' as const,description:'Quero leads de clínicas odontológicas no Rio de Janeiro',channel:'whatsapp' as const,timezone:'America/Sao_Paulo'};
 const jobs:Record<string,string>={};let calls=0;
 for(const [user,name,icp] of [[a,'Empresa A','Restaurantes em São Paulo'],[b,'Empresa B','Escritórios em Recife']] as const){
  const s=await readWorkspaceSnapshot(user.p);await executeWorkspaceCommand(user.p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'context.approve',profile:{...s.data.companyProfile,name,offer:'Software B2B',idealCustomer:icp,products:'Cadências',pains:'Falta de tempo'}}});
  const review=await preparePlanning(user.p,request);assert.deepEqual(review.blockers,[]);assert.equal(review.aiRoute?.conventional.provider,'openai');
  const job=await confirmPlanning(user.p,{requestId:randomUUID(),input:request,reviewToken:review.token});jobs[name]=job.id;
  await runPlanning(await grantTestLease(user.p,job.id),{generate:async(ctx,input)=>generatePlanning(ctx,input,{fetcher:async(_url,init)=>{
   calls++;const body=JSON.parse(String(init?.body));assert.equal(body.model,'fixture');const prompt=JSON.parse(body.input[0].content.split('\n').at(-1));
   assert.equal(prompt.approvedCompany.name,name);assert.equal(prompt.approvedCompany.idealCustomer,icp);assert.deepEqual(prompt.request,request);assert.equal(prompt.skill.version,AI_SKILLS_VERSION);
   assert.ok(!JSON.stringify(prompt).includes(name==='Empresa A'?'Empresa B':'Empresa A'));assert.equal(body.tools,undefined);
   return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(audienceResult())}]}]});
  }})});
  assert.equal((await getPlanning(user.p,job.id)).job.state,'completed');
  assert.equal(await testAdmin(async c=>(await c.query("SELECT COALESCE(sum((units->>'openaiCalls')::int),0)::int n FROM app.usage_ledger WHERE workspace_id=$1 AND event='consume'",[user.p.workspaceId])).rows[0].n),1);
 }
 assert.equal(calls,2);await assert.rejects(()=>getPlanning(b.p,jobs['Empresa A']),{status:404});await assert.rejects(()=>getPlanning(a.p,jobs['Empresa B']),{status:404});
 assert.equal(await testAdmin(async c=>(await c.query("SELECT count(*)::int n FROM app.usage_ledger WHERE workspace_id=$1 AND event='consume'",[admin.p.workspaceId])).rows[0].n),0);
 const stale=await preparePlanning(a.p,request),s=await readWorkspaceSnapshot(a.p);await executeWorkspaceCommand(a.p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'context.approve',profile:{...s.data.companyProfile,offer:'Oferta alterada'}}});
 await assert.rejects(()=>confirmPlanning(a.p,{requestId:randomUUID(),input:request,reviewToken:stale.token}),{status:409});
 const review=await preparePlanning(a.p,request),job=await confirmPlanning(a.p,{requestId:randomUUID(),input:request,reviewToken:review.token});
 await runPlanning(await grantTestLease(a.p,job.id),{generate:async(ctx,input)=>generatePlanning(ctx,input,{fetcher:async()=>{
  await saveAiPolicy(admin.p,{requestId:randomUUID(),expectedRevision:1,policy:{mode:'conventional-only',conventionalProvider:'openai',jevEnabled:false}});
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(audienceResult())}]}]});
 }})});
 const stopped=await getPlanning(a.p,job.id);assert.equal(stopped.job.state,'failed');
 assert.equal(await testAdmin(async c=>(await c.query('SELECT count(*)::int n FROM app.planning_proposal WHERE workspace_id=$1 AND job_id=$2',[a.p.workspaceId,job.id])).rows[0].n),0);
 assert.equal(await testAdmin(async c=>(await c.query("SELECT count(*)::int n FROM app.usage_ledger WHERE workspace_id=$1 AND job_id=$2 AND event='consume'",[a.p.workspaceId,job.id])).rows[0].n),1);
});
