import test, {after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import type {JobLease} from '../../src/domain/prospecting.ts';
import {resetRateLimits} from './helpers.ts';
import {closeProspectingPools, configureProspectingTest, generationInput, grantTestLease, prospectingUser, testAdmin} from './prospecting-helpers.ts';
import {prepareJob, confirmJob} from '../../src/server/prospecting/service.ts';
import {workerPool} from '../../src/server/prospecting/worker-db.ts';
import {withContextTransaction} from '../../src/server/db/transaction.ts';
import {openSiteQueue, claimSiteUrl, saveSiteUrl, siteQueueSnapshot} from '../../src/server/prospecting/site-queue.ts';
import {collectSiteTick, type SiteBrowser} from '../../src/server/prospecting/site-collection.ts';
import {loopbackSiteBrowser} from '../../src/server/prospecting/site-browser.ts';

configureProspectingTest();
beforeEach(resetRateLimits);
after(async()=>{await workerPool().end();await closeProspectingPools();});

const root='https://example.com/';
const contact='https://example.com/contato';
async function fixture(){
  const {p}=await prospectingUser({qaName:'[RE] Fila de sites'});
  const input=generationInput();
  const review=await prepareJob(p,input);
  const job=await confirmJob(p,{input,reviewToken:review.token,requestId:randomUUID()});
  return {p,id:job.id,lease:()=>grantTestLease(p,job.id)};
}

async function crashWorker(lease:JobLease,key:string,commit:boolean){
  assert.match(new URL(process.env.WORKER_DATABASE_URL!).pathname,/_test$/);
  const source=`
    import {claimSiteUrl,saveSiteUrl} from './src/server/prospecting/site-queue.ts';
    process.on('message',async ({lease,key,commit})=>{
      const claim=await claimSiteUrl(lease,key);
      const document={status:200,text:'[RE] texto confirmado'};
      if(commit)await saveSiteUrl(lease,key,claim,document,[{url:'https://example.com/contato',kind:'page'}]);
      process.send(claim);
    });
  `;
  const child=spawn(process.execPath,['--conditions=react-server','--experimental-strip-types','--input-type=module','-e',source],
    {stdio:['ignore','ignore','inherit','ipc'],windowsHide:true});
  const exit=once(child,'close');
  try{
    child.send({lease,key,commit});
    const [claim]=await Promise.race([
      once(child,'message',{signal:AbortSignal.timeout(15000)}),
      exit.then(()=>{throw Error('Worker exited before reaching the crash point');}),
    ]);
    return claim as NonNullable<Awaited<ReturnType<typeof claimSiteUrl>>>;
  }finally{
    child.kill('SIGKILL');
    await exit;
  }
}

test('a new worker fence resumes the same queue on both sides of the commit',async()=>{
  const f=await fixture();
  const first=await f.lease();
  const key=await openSiteQueue(first,root);
  const before=await crashWorker(first,key,false);
  assert.equal(before.url,'https://example.com/robots.txt');
  assert.equal(await claimSiteUrl(first,key),null,'one in-flight page per site');
  const second=await f.lease();
  assert.deepEqual(await claimSiteUrl(second,key),before);
  await assert.rejects(saveSiteUrl(first,key,before!,{status:200,text:'stale'},[]),{code:'STALE_JOB'});
  await saveSiteUrl(second,key,before!,{status:404,text:''},[{url:root,kind:'page'}]);
  const third=await f.lease();
  assert.equal(await openSiteQueue(third,root),key);
  const page=await claimSiteUrl(third,key);
  assert.equal(page?.url,root,'robots must never be read again after commit');
  await assert.rejects(saveSiteUrl(third,key,page!,{status:200,text:'rollback'},[{url:'not a URL',kind:'page'}]));
  const rolledBack=(await siteQueueSnapshot(third,key)).find(row=>row.url===root);
  assert.equal(rolledBack?.state,'processing');
  assert.equal(rolledBack?.result,null,'the page must roll back with its frontier');
  const fourth=await f.lease();
  assert.equal((await crashWorker(fourth,key,true)).url,root);
  const fifth=await f.lease();
  assert.equal((await claimSiteUrl(fifth,key))?.url,contact);
  const snapshot=await siteQueueSnapshot(fifth,key);
  assert.deepEqual(snapshot.map(row=>[row.url,row.state,row.result?.text]),[
    [root,'completed','[RE] texto confirmado'],[contact,'processing',undefined],
    ['https://example.com/robots.txt','completed',''],
  ]);
  assert.match(snapshot[0].result!.hash,/^[a-f0-9]{64}$/);
});

test('crawl explores sitemap and rendered links, retries a timeout and reports blocked URLs',async()=>{
  const f=await fixture();
  const calls:string[]=[];
  const browser:SiteBrowser={
    async read(kind,url){
      const path=new URL(url).pathname;
      calls.push(path);
      if (kind==='robots') return {status:200,text:'User-agent: *\nDisallow: /restrito\nAllow: /restrito/publico\nSitemap: https://example.com/sitemap.xml'};
      if (kind==='sitemap') return {status:200,text:'<urlset><url><loc>https://example.com/sobre</loc></url><url><loc>https://example.com/restrito</loc></url><url><loc>https://example.com/restrito/publico</loc></url></urlset>'};
      if (path==='/sobre'&&calls.filter(call=>call===path).length===1) return {status:504,text:''};
      return {status:200,text:path,links:path==='/'?['/contato#telefone','/contato','https://example.org/sair']:[]};
    },
  };
  let result:Awaited<ReturnType<typeof collectSiteTick>>;
  for (let i=0;i<12;i++){
    result=await collectSiteTick(await f.lease(),root,browser,AbortSignal.timeout(1000));
    if (result.done) break;
    await testAdmin(c=>c.query("UPDATE app.prospecting_site_page SET retry_at=clock_timestamp() WHERE job_id=$1 AND state='pending'",[f.id]));
  }
  assert.deepEqual(calls,['/robots.txt','/sitemap.xml','/','/contato','/sobre','/sobre','/restrito/publico']);
  assert.equal(result!.done,true);
  assert.deepEqual(result!.coverage,{pending:0,completed:4,blocked:1,failed:0,partial:true});
});

test('cancellation and a foreign workspace cannot publish or read the original queue',async()=>{
  const f=await fixture();
  const lease=await f.lease();
  const key=await openSiteQueue(lease,root);
  const claimed=await claimSiteUrl(lease,key);
  const foreign=await (await fixture()).lease();
  assert.deepEqual(await siteQueueSnapshot(foreign,key),[]);
  const rawCount=(l:typeof lease)=>withContextTransaction(workerPool(),{workspaceId:l.workspaceId,userId:l.actorId,role:'operator',sessionId:'[RE]'},async c=>{
    await c.query("SELECT set_config('app.publication_job',$1,true),set_config('app.publication_token',$2,true),set_config('app.publication_fence',$3,true)",
      [lease.jobId,lease.token,String(lease.fence)]);
    return (await c.query('SELECT url FROM app.prospecting_site_page')).rowCount;
  });
  assert.equal(await rawCount(lease),1,'the owner can see the page using only the SQL policy');
  assert.equal(await rawCount(foreign),0,'a foreign workspace cannot see the row even with copied fence settings');
  await testAdmin(c=>c.query("UPDATE app.prospecting_job SET state='cancelling' WHERE id=$1",[f.id]));
  await assert.rejects(saveSiteUrl(lease,key,claimed!,{status:200,text:'stale'},[]),{code:'STALE_JOB'});
});

test('a circular navigation yields partial coverage and no collected document',async()=>{
  const f=await fixture();
  const reads:string[]=[];
  const browser:SiteBrowser={async read(kind,url){
    reads.push(url);
    if(kind!=='page')return {status:404,text:''};
    return {status:302,text:'',redirect:url===root?'/home':'/'};
  }};
  let result;
  do {
    assert.ok(reads.length<5);
    result=await collectSiteTick(await f.lease(),root,browser);
  }while(!result.done);
  assert.equal(reads.length,4);
  assert.equal(result.coverage.completed,0);
  assert.equal(result.coverage.partial,true);
  assert.deepEqual(result.pages,[]);
});

test('an unsupported metadata encoding cannot silently turn robots rules into empty text',async t=>{
  const before=process.env.SITE_BROWSER_TOKEN;
  process.env.SITE_BROWSER_TOKEN='[RE] fixture credential for isolated browser test';
  t.after(()=>{if(before===undefined)delete process.env.SITE_BROWSER_TOKEN;else process.env.SITE_BROWSER_TOKEN=before;});
  const response={status:200,headers:{'content-encoding':'br'},body:'AAAA'};
  const fetch=t.mock.method(globalThis,'fetch',async()=>Response.json(response));
  await assert.rejects(loopbackSiteBrowser.read('robots',root,AbortSignal.timeout(1000)),{code:'INVALID_COMPRESSED_DOCUMENT'});
  assert.equal(fetch.mock.callCount(),1);
});
