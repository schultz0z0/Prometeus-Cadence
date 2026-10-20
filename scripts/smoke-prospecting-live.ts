// Direct synthetic provider smoke; never triggered by the UI or the default suite.
export {};
process.loadEnvFile('.env.local');
const args=process.argv.slice(2),value=(key:string)=>args[args.indexOf(key)+1];
const source=value('--source'),workspaceId=value('--workspace');
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
    const {prospectingConfig}=await import('../src/server/prospecting/config.ts');const config=prospectingConfig();
    if(source==='JEV'&&!args.includes('--confirm-provider-cost'))throw Error('Explicit provider cost acknowledgement required.');
    if(source==='JEV'&&!config.jevReady)throw Error('JEV key/model missing.');
    const {executeWorkspaceCommand,readWorkspaceSnapshot}=await import('../src/server/workspaces/commands.ts');
    const snapshot=await readWorkspaceSnapshot(p),listId=randomUUID(),leadId=randomUUID();
    const lead={id:leadId,listId,name:'QA synthetic dental clinic',site:'https://example.com/',source:'MANUAL',qualification:'pending',createdAt:new Date().toISOString()};
    await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:snapshot.revision,command:{type:'leads.import',leads:[lead],list:{id:listId,name:'QA synthetic AI smoke'}}});
    if(source==='JEV'){
      const current=await readWorkspaceSnapshot(p);await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:current.revision,command:{type:'context.approve',profile:{...current.data.companyProfile,idealCustomer:'Dental clinics'}}});
    }
    const input={kind:'qualification' as const,listId,leadIds:[leadId],modules:[source==='JEV'?'qualify' as const:'summary' as const],summaryPolicy:'all' as const,escalation:'off' as const};
    const review=await prepareJob(p,input);if(review.blockers.length)throw Error(review.blockers.join(' '));const job=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:review.token});
    const {claimJob}=await import('../src/server/prospecting/lease.ts'),lease=await claimJob('explicit-live-smoke',workspaceId);if(!lease||lease.jobId!==job.id)throw Error('QA queue is not empty; start no calls.');
    const {runQualification}=await import('../src/server/prospecting/qualification.ts');
    const signal=AbortSignal.timeout(120000),evidence=[{id:randomUUID(),url:'https://example.com/',fetchedAt:new Date().toISOString(),text:'Synthetic QA company: a dental clinic offering orthodontics, appointments and general dentistry.',hash:'synthetic-smoke-v1',truncated:false}];
    const {heartbeat}=await import('../src/server/prospecting/lease.ts');const timer=setInterval(()=>void heartbeat(lease).catch(()=>{}),10000);
    try{await runQualification(lease,{signal,collect:async()=>evidence});await runQualification(lease,{signal,collect:async()=>evidence});}finally{clearInterval(timer);}
    const result=await getJob(p,job.id);if(result.state!=='completed')throw Error('Smoke did not complete: '+result.state);
    console.log(JSON.stringify({status:'COMPLETED',source,synthetic:true,jobId:job.id,usage:result.usage,note:'Transport smoke only, not an accuracy evaluation. Proposals not applied.'}));
  }
}finally{await Promise.all([getPools().close(),workerPool().end()]);}
