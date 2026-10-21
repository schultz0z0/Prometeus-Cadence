// Direct synthetic provider smoke; never triggered by the UI or the default suite.
export {};
process.loadEnvFile('.env.local');
const args=process.argv.slice(2),value=(key:string)=>args.includes(key)?args[args.indexOf(key)+1]:undefined;
const {parseSmokeOptions}=await import('./prospecting-smoke-options.ts');const options=parseSmokeOptions(args);if(!options.live)throw Error('Explicit live mode required.');
const {source,workspaceId}=options;
const allowed=(process.env.PROSPECTING_SMOKE_WORKSPACE_IDS??'').split(',').includes(workspaceId);
if(!allowed)throw Error('QA workspace must be explicitly allowlisted on the server.');
const {getPools}=await import('../src/server/db/pool.ts');
const {workerPool,withLeasedTransaction}=await import('../src/server/prospecting/worker-db.ts');
const {withWorkspaceTransaction}=await import('../src/server/db/transaction.ts');
const {randomUUID}=await import('node:crypto');
try{
  // Resolve only a real owner membership under the configured runtime's RLS context.
  const member=(await getPools().authPool.query('SELECT "userId" FROM auth.member WHERE "organizationId"=$1 AND role=\'owner\'',[workspaceId])).rows[0];
  if(!member)throw Error('QA workspace owner required.');
  const p={userId:member.userId,workspaceId,role:'owner' as const,sessionId:'explicit-cli-smoke'};
  const {prepareJob,confirmJob,getJob}=await import('../src/server/prospecting/service.ts');
  if(['MAPS','WEB','CNPJ','APOLLO'].includes(source)){
    if(!args.includes('--confirm-provider-cost')||!value('--term'))throw Error('Explicit provider cost acknowledgement and --term required.');
    const input={kind:'generation' as const,source:source as 'MAPS'|'WEB'|'CNPJ'|'APOLLO',destination:{mode:'new' as const,name:'QA live smoke '+new Date().toISOString()},limit:1,dedupScope:'workspace' as const,filters:{term:value('--term'),...(value('--location')?{location:value('--location')}:{}),...(source==='CNPJ'?{cnae:value('--cnae')}: {})}};
    const review=await prepareJob(p,input);if(review.blockers.length)throw Error(review.blockers.join(' '));
    const job=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:review.token});
    console.log(JSON.stringify({status:'QUEUED',jobId:job.id,note:'Start worker; queued is not a successful provider smoke. Inspect completed results and usage.'}));
  }else{
    const {getAiSettings,prepareAiTest,confirmAiTest}=await import('../src/server/prospecting/ai/probe.ts');
    const {runWorkerOnce}=await import('../src/server/prospecting/worker.ts');
    const settings=await getAiSettings(p),expected=source==='CODEX'?'codex-local':source.toLowerCase();
    if(settings.policy.conventionalProvider!==expected)throw Error('Select the requested conventional provider in AI settings first.');
    const existing=await withWorkspaceTransaction(p,c=>c.query("SELECT 1 FROM app.prospecting_job WHERE state IN('queued','running','waiting_provider','cancelling','needs_reconciliation') LIMIT 1"));
    if(existing.rowCount)throw Error('QA queue must be empty before the live smoke.');
    const review=await prepareAiTest(p);if(review.blockers.length)throw Error(review.blockers.join(' '));
    const job=await confirmAiTest(p,{requestId:randomUUID(),draft:review.draft,reviewToken:review.token});
    for(let step=0;step<3;step++){const state=await getJob(p,job.id);if(['completed','failed','partial','needs_reconciliation'].includes(state.state))break;await runWorkerOnce({},{workspaceId,signal:AbortSignal.timeout(130000)});}
    const result=await getJob(p,job.id);if(result.state!=='completed')throw Error('Smoke did not complete: '+result.state);
    console.log(JSON.stringify({status:'COMPLETED',source,synthetic:true,jobId:job.id,usage:result.usage,note:'Connection transport test only, not empirical accuracy. No proposals applied.'}));
  }
}finally{await Promise.all([getPools().close(),workerPool().end()]);}
