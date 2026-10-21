// Explicit, single-lead acceptance run. No inference, result application or messages.
export {};
process.loadEnvFile('.env.local');
const args=process.argv.slice(2),value=(key:string)=>args.includes(key)?args[args.indexOf(key)+1]:undefined;
const workspaceId=value('--workspace'),leadId=value('--lead'),resume=value('--job');
if(!args.includes('--live')||!args.includes('--confirm-provider-cost')||!workspaceId||!leadId||!(process.env.PROSPECTING_SMOKE_WORKSPACE_IDS??'').split(',').includes(workspaceId))throw Error('Explicit live/cost acknowledgement, QA workspace and one lead required.');
const {getPools}=await import('../src/server/db/pool.ts');
const {withWorkspaceTransaction}=await import('../src/server/db/transaction.ts');
const {workerPool}=await import('../src/server/prospecting/worker-db.ts');
const {prepareJob,confirmJob,getJob,listJobItems}=await import('../src/server/prospecting/service.ts');
const {runWorkerOnce}=await import('../src/server/prospecting/worker.ts');
const {randomUUID}=await import('node:crypto');
try{
  const member=(await getPools().authPool.query('SELECT "userId" FROM auth.member WHERE "organizationId"=$1 AND role=\'owner\'',[workspaceId])).rows[0];
  if(!member)throw Error('QA owner required.');
  const p={userId:member.userId,workspaceId,role:'owner' as const,sessionId:'explicit-enrichment-smoke'};
  const assertExclusive=async(jobId:string)=>{const other=await withWorkspaceTransaction(p,c=>c.query("SELECT 1 FROM app.prospecting_job WHERE id<>$1 AND state IN('queued','running','waiting_provider','cancelling','needs_reconciliation') LIMIT 1",[jobId]));if(other.rowCount)throw Error('Another QA job is active; refusing workspace worker dispatch.');};
  const lead=await withWorkspaceTransaction(p,async c=>(await c.query('SELECT payload FROM app.lead WHERE id=$1',[leadId])).rows[0]?.payload);
  if(!lead)throw Error('Lead not found in QA workspace.');
  let jobId=resume;
  if(resume){const old=await withWorkspaceTransaction(p,async c=>(await c.query('SELECT input FROM app.prospecting_job WHERE id=$1',[resume])).rows[0]);if(old?.input.kind!=='qualification'||old.input.leadIds.length!==1||old.input.leadIds[0]!==leadId||old.input.modules.some((m:string)=>['qualify','summary'].includes(m)))throw Error('Resume scope mismatch.');}
  else{
    const active=await withWorkspaceTransaction(p,c=>c.query("SELECT 1 FROM app.prospecting_job WHERE state IN('queued','running','waiting_provider','cancelling','needs_reconciliation') LIMIT 1"));
    if(active.rowCount)throw Error('QA queue must be empty before starting.');
    const input={kind:'qualification' as const,listId:lead.listId,leadIds:[leadId],modules:['registry','website','deep','email','phone','validateEmail'] as const,summaryPolicy:'all' as const,escalation:'off' as const};
    const review=await prepareJob(p,{...input,modules:[...input.modules]});if(review.blockers.length)throw Error(review.blockers.join(' '));
    jobId=(await confirmJob(p,{requestId:randomUUID(),input,reviewToken:review.token})).id;
    console.log(JSON.stringify({queued:jobId,scope:'one existing lead',maxApifyRuns:2,applied:false}));
  }
  // No automatic retries or continuous worker: at most fifteen durable worker ticks.
  for(let step=0;step<15;step++){
    const job=await getJob(p,jobId!);if(['completed','partial','failed','cancelled','needs_reconciliation'].includes(job.state))break;
    await assertExclusive(jobId!);
    await runWorkerOnce({},{workspaceId,signal:AbortSignal.timeout(45000)});
    const after=await getJob(p,jobId!);console.log(JSON.stringify({jobId,step:step+1,state:after.state}));
    if(!['completed','partial','failed','cancelled','needs_reconciliation'].includes(after.state))await new Promise(r=>setTimeout(r,2000));
  }
  const job=await getJob(p,jobId!),items=await listJobItems(p,jobId!);
  console.log(JSON.stringify({jobId,state:job.state,counts:job.counts,items:items.items.map(i=>({id:i.id,results:i.results,evidence:i.evidence})),usage:job.usage,applied:false}));
  if(job.state!=='completed')process.exitCode=1;
}finally{await Promise.all([getPools().close(),workerPool().end()]);}
