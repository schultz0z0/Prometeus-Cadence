// Three-call QA acceptance: real lead evidence, explicitly fictitious offering,
// no qualification application, cadence creation or message dispatch.
export {};
process.loadEnvFile('.env.local');
const args=process.argv.slice(2),value=(k:string)=>args.includes(k)?args[args.indexOf(k)+1]:undefined;
const workspaceId=value('--workspace'),leadId=value('--lead'),offer=value('--qa-offer'),cadenceOnly=args.includes('--cadence-only');
if(!args.includes('--live')||!args.includes('--confirm-codex-usage')||!workspaceId||!leadId||!offer||!(process.env.PROSPECTING_SMOKE_WORKSPACE_IDS??'').split(',').includes(workspaceId)||!(process.env.CODEX_TEST_WORKSPACE_IDS??'').split(',').includes(workspaceId))throw Error('Explicit QA scope, fictitious offer and Codex usage confirmation required.');
const {getPools}=await import('../src/server/db/pool.ts');
const {withWorkspaceTransaction}=await import('../src/server/db/transaction.ts');
const {workerPool}=await import('../src/server/prospecting/worker-db.ts');
const {prepareJob,confirmJob,getJob,listJobItems}=await import('../src/server/prospecting/service.ts');
const {runWorkerOnce}=await import('../src/server/prospecting/worker.ts');
const {readWorkspaceSnapshot,executeWorkspaceCommand}=await import('../src/server/workspaces/commands.ts');
const {saveAiPolicy,readAiPolicy}=await import('../src/server/prospecting/ai/settings.ts');
const {preparePlanning,confirmPlanning,getPlanning}=await import('../src/server/planning/service.ts');
const {diagnoseCodex}=await import('../src/server/prospecting/ai/diagnostics.ts');
const {randomUUID}=await import('node:crypto');
try{
 const member=(await getPools().authPool.query('SELECT "userId" FROM auth.member WHERE "organizationId"=$1 AND role=\'owner\'',[workspaceId])).rows[0];if(!member)throw Error('QA owner required.');
 const p={userId:member.userId,workspaceId,role:'owner' as const,sessionId:'explicit-three-call-ai-smoke'};
 const active=await withWorkspaceTransaction(p,c=>c.query("SELECT 1 FROM app.prospecting_job WHERE state IN('queued','running','waiting_provider','cancelling','needs_reconciliation') LIMIT 1"));if(active.rowCount)throw Error('QA queue must be empty.');
 const diagnostic=await diagnoseCodex();if(!diagnostic.authenticated)throw Error(diagnostic.code??'Codex unavailable');console.log(JSON.stringify({diagnostic,maxNewInferences:cadenceOnly?1:3}));
 let snapshot=await readWorkspaceSnapshot(p);const lead=snapshot.data.leads.find(l=>l.id===leadId);if(!lead?.site)throw Error('One existing QA lead with public site required.');
 if(snapshot.data.companyProfile.approvedAt&&!snapshot.data.companyProfile.name.startsWith('QA'))throw Error('Refusing to overwrite a real approved company context.');
 if(cadenceOnly&&!snapshot.data.companyProfile.approvedAt)throw Error('Existing approved QA context required for cadence-only.');
 const currentPolicy=await withWorkspaceTransaction(p,c=>readAiPolicy(c));
 if(cadenceOnly&&(currentPolicy.mode!=='conventional-only'||currentPolicy.conventionalProvider!=='codex-local'||currentPolicy.jevEnabled))throw Error('Cadence-only requires the existing conventional-only Codex route with JEV disabled.');
 if(!cadenceOnly){
 const policy=await withWorkspaceTransaction(p,c=>readAiPolicy(c));
 await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:policy.revision,policy:{mode:'conventional-only',conventionalProvider:'codex-local',jevEnabled:false}});
 snapshot=await readWorkspaceSnapshot(p);
 await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:snapshot.revision,command:{type:'context.approve',profile:{...snapshot.data.companyProfile,name:'QA · oferta fictícia para aceite técnico',offer:'QA — oferta fictícia: '+offer,idealCustomer:'Clínicas de estética com atendimento e agendamento publicados no site.',pains:'Hipótese de QA: organização de agendamento; não afirmar que a empresa tem esse problema.',differentiators:'',socialProof:'',sources:'Oferta fictícia exclusivamente para teste técnico autorizado. Empresa prospectada obtida de fontes públicas reais.'}}});
 const input={kind:'qualification' as const,listId:lead.listId,leadIds:[lead.id],modules:['qualify','summary'],summaryPolicy:'all' as const,escalation:'off' as const};
 const review=await prepareJob(p,input);if(review.blockers.length)throw Error(review.blockers.join(' '));
 const job=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:review.token});console.log(JSON.stringify({qualificationJob:job.id}));
 for(let tick=0;tick<4;tick++){if(['completed','partial','failed','needs_reconciliation'].includes((await getJob(p,job.id)).state))break;await runWorkerOnce({},{workspaceId,signal:AbortSignal.timeout(130000)});console.log(JSON.stringify({jobId:job.id,tick:tick+1,state:(await getJob(p,job.id)).state}));}
 const qualified=await getJob(p,job.id);console.log(JSON.stringify({jobId:job.id,state:qualified.state,usage:qualified.usage,items:(await listJobItems(p,job.id)).items}));
 if(qualified.state!=='completed')throw Error('AI qualification incomplete; no repeat inference.');
 }
 const request={kind:'planning' as const,task:'cadence_options' as const,listId:lead.listId,objective:'QA: apresentar oferta fictícia e solicitar conversa, sem afirmar dores não comprovadas.',channels:['WHATSAPP','EMAIL'],tone:'profissional e breve',rhythm:'Padrão',highlight:'Demonstração técnica de automação de agendamento. Identificar como proposta, sem promessas.',avoid:'Não inventar clientes, resultados ou problemas da clínica.',decisionMaker:'responsável pelo atendimento'};
 const plan=await preparePlanning(p,request);if(plan.blockers.length)throw Error(plan.blockers.join(' '));
 const cadence=await confirmPlanning(p,{requestId:randomUUID(),input:request,reviewToken:plan.token});console.log(JSON.stringify({cadenceJob:cadence.id}));
 await runWorkerOnce({},{workspaceId,signal:AbortSignal.timeout(130000)});
 const result=await getPlanning(p,cadence.id);console.log(JSON.stringify({jobId:cadence.id,state:result.job.state,usage:result.job.usage,proposal:result.proposal,applied:false,sent:false}));if(result.job.state!=='completed')process.exitCode=1;
}finally{await Promise.all([getPools().close(),workerPool().end()]);}
