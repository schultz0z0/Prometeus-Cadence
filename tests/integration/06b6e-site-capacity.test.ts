import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Candidate,CandidatePage,RemoteRun} from '../../src/domain/prospecting.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {readExtractionDay} from '../../src/server/billing/extraction-day.ts';
import {saveAiPolicy} from '../../src/server/prospecting/ai/settings.ts';
import {ProviderError} from '../../src/server/prospecting/providers/transport.ts';
import type {SourceAdapter} from '../../src/server/prospecting/providers/types.ts';
import {getJob} from '../../src/server/prospecting/service.ts';
import type {SiteBrowser} from '../../src/server/prospecting/site-browser.ts';
import {runWorkerOnce} from '../../src/server/prospecting/worker.ts';
import {workerPool} from '../../src/server/prospecting/worker-db.ts';
import {confirmJourney,prepareJourney} from '../../src/server/research/journey.ts';
import {closeProspectingPools,configureProspectingTest,prospectingUser,testAdmin} from './prospecting-helpers.ts';

configureProspectingTest();
Object.assign(process.env,{
  APIFY_CNPJ_ACTOR:'bigdavidson/brazil-cnpj-companies',APIFY_CNPJ_BUILD:'fixture-build',
  APIFY_CNPJ_DATE_SLICES:'true',
  APIFY_WEB_ACTOR:'apify/google-search-scraper',APIFY_WEB_BUILD:'fixture-build',
  OPENAI_API_KEY:'fixture',OPENAI_MODEL:'fixture',PROSPECTING_GLOBAL_CONCURRENCY:'32',
  PROSPECTING_WORKSPACE_DAILY_UNITS:JSON.stringify({candidates:1000,apifyRuns:2000,openaiCalls:2000}),
  PROSPECTING_GLOBAL_DAILY_UNITS:JSON.stringify({candidates:100000,apifyRuns:100000,openaiCalls:100000}),
});
after(async()=>{await workerPool().end();await closeProspectingPools();});

function cnpj(sequence:number){
  const base=[...String(10_000_000+sequence)+'0001'].map(Number);
  for(const weights of [[5,4,3,2,9,8,7,6,5,4,3,2],[6,5,4,3,2,9,8,7,6,5,4,3,2]]){
    const remainder=base.reduce((sum,digit,index)=>sum+digit*weights[index],0)%11;
    base.push(remainder<2?0:11-remainder);
  }
  return base.join('');
}

async function setup(limit:number,central=false){
  const {p}=await prospectingUser({platformAi:central,qaName:'[RE] Capacidade de coleta'});
  if(central)await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:0,policy:{mode:'conventional-only',conventionalProvider:'openai',jevEnabled:false}});
  await testAdmin(async c=>{
    await c.query('INSERT INTO app.context_version(workspace_id,version,payload) VALUES($1,1,$2)',
      [p.workspaceId,{version:1,approvedAt:new Date().toISOString(),offer:'[RE] Gestão comercial',idealCustomer:'[RE] Empresas de esquadrias'}]);
    await c.query("UPDATE app.billing_account SET state='active',plan='essential' WHERE workspace_id=$1",[p.workspaceId]);
    await c.query("UPDATE app.billing_grant SET source='plan',quantity=5000 WHERE workspace_id=$1 AND unit='extractions'",[p.workspaceId]);
  });
  const input={brief:'[RE] Esquadrias',location:'Curitiba, PR',limit,registry:{cnae:'2512800',city:'Curitiba',uf:'PR'}};
  const review=await prepareJourney(p,input);
  assert.deepEqual(review.blockers,[]);
  const journey=await confirmJourney(p,{input,token:review.token,requestId:randomUUID()});
  return {p,id:journey.stages[0].jobId!};
}

function sources(id:string,count:number,discarded=0,interruptAt=-1){
  const records:Candidate[]=Array.from({length:count},(_,index)=>({
    name:'[RE] Esquadrias Modelo '+index,source:'CNPJ',sourceRef:'registro-'+index,
    cnpj:cnpj(index),city:'Curitiba',state:'PR',cnae:'2512800',openedAt:index<129?'2020-01-01':'2019-12-31',
    phone:'+55419999'+String(10_000+index).slice(1),address:'Rua Exemplo, '+(index+1),facts:{registrationStatus:'ATIVA'},
  }));
  const byName=new Map(records.map((entry,index)=>[entry.name,index]));
  const datasets=new Map<string,Candidate[]>();
  const starts=new Map<string,number>(),pages=new Map<string,number>(),reads=new Map<string,number>();
  const countCall=(calls:Map<string,number>,key:string)=>calls.set(key,(calls.get(key)??0)+1).get(key)!;
  function page(entries:Candidate[],receiptId:string,nextCursor:string|null=null):CandidatePage{
    return {receiptId,candidates:entries,rejected:[],rawCount:entries.length,nextCursor,exhausted:nextCursor===null,
      usage:{provider:'apify',operationId:receiptId,units:{candidates:entries.length},costUsd:null,costKind:'unknown'}};
  }
  const apify:SourceAdapter={
    async start(ctx,input){
      if(ctx.profile.source==='CNPJ'){
        assert.equal(ctx.profile.registryFirst,true);
        const newer=ctx.profile.registryWindow?.openedFrom==='2020-01-01';
        assert.ok(newer||ctx.profile.registryWindow?.openedTo==='2019-12-31');
        const slice=newer?'newer':'older',runId='fixture-'+id+'-'+slice;
        assert.equal(countCall(starts,'registry-'+slice),1);
        datasets.set(runId,records.filter(entry=>(entry.openedAt==='2020-01-01')===newer).slice(0,input.limit));
        const run:RemoteRun={provider:'apify',runId,datasetId:runId,profileId:ctx.profile.actor,build:ctx.profile.build,operationId:ctx.operationId};
        return {kind:'remote',run};
      }
      assert.equal(ctx.profile.source,'MAPS');
      const index=byName.get(input.filters.term)!;
      const entry=records[index];
      assert.ok(entry);
      assert.equal(countCall(starts,'maps-'+index),1);
      const result:Candidate={...entry,cnpj:undefined,source:'MAPS',sourceRef:'maps-'+index,site:'https://empresa-'+index+'.example/',
        address:index<discarded?'Rua Homonima, 9999':entry.address};
      return {kind:'inline',page:page([result],ctx.operationId)};
    },
    async poll(_ctx,run){return {status:'succeeded',run};},
    async readPage(_ctx,run,cursor,limit){
      const offset=Number(cursor??0);
      assert.ok(limit!==undefined&&limit>0,'the worker requests a bounded dataset page');
      const dataset=datasets.get(run.runId);
      assert.ok(dataset);
      const receipt=run.runId+'-'+offset;
      assert.equal(countCall(pages,receipt),1);
      const next=Math.min(offset+limit,dataset.length);
      return page(dataset.slice(offset,next),receipt,next===dataset.length?null:String(next));
    },
    async abort(){throw Error('Unexpected provider abort');},
  };
  const siteBrowser:SiteBrowser={
    async available(){return true;},
    async read(kind,url){
      const index=Number(new URL(url).hostname.match(/^empresa-(\d+)\.example$/)?.[1]);
      const entry=records[index];
      assert.ok(entry);
      const attempts=countCall(reads,kind+'-'+index);
      if(kind!=='page')return {status:404,text:''};
      if(index===interruptAt&&attempts===1)throw new ProviderError('BUSY',503);
      return {status:200,finalUrl:url,text:entry.name+' CNPJ '+entry.cnpj+' Telefone '+entry.phone};
    },
  };
  return {apify,siteBrowser,starts,pages,reads};
}

test('Capacity250 admits replacements and preserves pages, billing and workspace boundaries', {timeout:900_000}, async t=>{
  const begin=performance.now(),initialRss=process.memoryUsage().rss,durations:number[]=[];
  let peakRss=initialRss;
  const large=await setup(250,true),other=await setup(1);
  t.mock.method(globalThis,'fetch',async()=>{throw Error('External fetch forbidden in Capacity250 worker');});
  const primary=sources(large.id,254,4,7),secondary=sources(other.id,1);
  const tick=async(run:typeof large,adapters:typeof primary)=>{
    const start=performance.now();
    const claimed=await runWorkerOnce(adapters,{workspaceId:run.p.workspaceId,signal:AbortSignal.any([t.signal,AbortSignal.timeout(20_000)])});
    durations.push(performance.now()-start);
    peakRss=Math.max(peakRss,process.memoryUsage().rss);
    const status=await testAdmin(async c=>(await c.query(
      'SELECT state,error_code,counts FROM app.prospecting_job WHERE id=$1 AND workspace_id=$2',[run.id,run.p.workspaceId])).rows[0]);
    assert.equal(claimed,true,JSON.stringify({turn:durations.length,...status}));
    return status;
  };
  let interrupted=false;
  let result;
  for(let turns=0;turns<900;turns++){
    result=await tick(large,primary);
    if(turns%100===99)console.log(JSON.stringify({capacityTurn:turns+1,inserted:result.counts.inserted,elapsedMs:Math.round(performance.now()-begin)}));
    if(result.error_code==='WAITING_SITE_BROWSER'){
      assert.equal(interrupted,false);
      interrupted=true;
      assert.ok(result.counts.inserted>0);
      assert.equal(await runWorkerOnce(primary,{workspaceId:large.p.workspaceId,signal:AbortSignal.timeout(5_000)}),false);
      let separate;
      for(let turns=0;turns<8;turns++){
        separate=await tick(other,secondary);
        if(separate.state==='completed')break;
      }
      assert.equal(separate?.counts.inserted,1);
      await assert.rejects(getJob(other.p,large.id),{status:404});
      await testAdmin(c=>c.query('UPDATE app.prospecting_job SET capacity_retry_at=clock_timestamp() WHERE id=$1',[large.id]));
    }else if(['completed','partial','failed','needs_reconciliation'].includes(result.state))break;
  }
  assert.ok(interrupted);
  result=await getJob(large.p,large.id);
  assert.equal(result?.state,'completed',JSON.stringify({counts:result?.counts,error:result?.error,reasons:result?.discoveryReasons}));
  assert.deepEqual(result.counts,{found:254,inserted:250,duplicates:0,rejected:4,pending:0});
  assert.equal(result.discoveryReasons?.MAPS_IDENTITY_UNVERIFIED,4);
  assert.equal(result.siteCollection?.completed,250);
  assert.equal(primary.reads.get('page-7'),2);
  assert.equal(primary.reads.get('page-4'),1);
  assert.equal(primary.starts.size,256);
  assert.equal(primary.starts.get('registry-newer'),1);
  assert.equal(primary.starts.get('registry-older'),1);
  assert.equal(secondary.starts.has('registry-older'),false);
  assert.equal([...primary.reads.values()].reduce((sum,value)=>sum+value,0),751);
  const balance=await withWorkspaceTransaction(large.p,readExtractionDay);
  assert.equal(balance?.plan,250);
  assert.equal(balance?.planBalance,4750);
  assert.equal((await withWorkspaceTransaction(other.p,readExtractionDay))?.plan,1);
  for(const [run,expected] of [[large,250],[other,1]] as const){
    const settlement=await testAdmin(async c=>(await c.query(
      "SELECT COALESCE(sum(a.spent),0)::int AS spent,COALESCE(sum(a.held),0)::int AS held,bool_and(r.closed) AS closed FROM app.billing_allocation a JOIN app.billing_reservation r USING(workspace_id,key,unit) WHERE a.workspace_id=$1 AND a.key=$2 AND a.unit='extractions'",
      [run.p.workspaceId,'job:'+run.id])).rows[0]);
    assert.deepEqual(settlement,{spent:expected,held:0,closed:true});
  }
  durations.sort((a,b)=>a-b);
  t.diagnostic(JSON.stringify({delivered:250,rejected:4,datasetPages:primary.pages.size,providerStarts:primary.starts.size,browserReads:751,
    workerTicks:durations.length,workerTickP95Ms:Math.round(durations[Math.ceil(durations.length*.95)-1]),
    elapsedMs:Math.round(performance.now()-begin),nodeRssPeakMiB:Math.round(peakRss/1048576),nodeRssStartMiB:Math.round(initialRss/1048576)}));
});
