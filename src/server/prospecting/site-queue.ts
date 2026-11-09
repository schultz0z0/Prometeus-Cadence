import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {JobLease} from '../../domain/prospecting.ts';
import {AppError} from '../errors.ts';
import {assertJobLease} from './repository.ts';
import {withLeasedTransaction} from './worker-db.ts';
import {siteUrl} from './site-policy.ts';

export type SiteUrl = {url:string; kind:'robots'|'sitemap'|'page'};
export type SitePageResult = {status:number; text:string; finalUrl?:string; redirect?:string; links?:string[]; contacts?:string[]; externalLinks?:string[]; truncated?:boolean};
export type SiteClaim = SiteUrl & {failures:number};
type SiteState = 'pending'|'processing'|'completed'|'blocked'|'failed';
type SiteRow = SiteClaim & {state:SiteState; retry_at:Date|string; result:(SitePageResult & {hash:string; fetchedAt:string})|null; reason:string|null};
const limit = 500;
const hash = (value:string) => createHash('sha256').update(value).digest('hex');

function priority({url,kind}:SiteUrl) {
  if (kind==='robots') return 0;
  if (kind==='sitemap') return 1;
  if (new URL(url).pathname==='/') return 2;
  return /contat|contact|sobre|about|privac|legal|termos|terms|cnpj|institucional|quem-somos/i.test(new URL(url).pathname) ? 3 : 4;
}

function active<T>(lease:JobLease,fn:(client:PoolClient)=>Promise<T>) {
  return withLeasedTransaction(lease,async client=>{
    await assertJobLease(client,lease);
    return fn(client);
  });
}

async function enqueue(client:PoolClient,lease:JobLease,key:string,entries:SiteUrl[]) {
  const records=[...new Map(entries.map(entry=>[entry.url,{...entry,priority:priority(entry)}])).values()];
  const saved=await client.query(
    `INSERT INTO app.prospecting_site_page(workspace_id,job_id,site_key,url,kind,priority)
     SELECT $1,$2,$3,e.url,e.kind,e.priority
       FROM jsonb_to_recordset($4::jsonb) AS e(url text,kind text,priority smallint)
      WHERE NOT EXISTS (SELECT 1 FROM app.prospecting_site_page p
         WHERE p.workspace_id=$1 AND p.job_id=$2 AND p.site_key=$3 AND p.url=e.url)
      ORDER BY e.priority,e.url
      LIMIT GREATEST(0,$5-(SELECT count(*) FROM app.prospecting_site_page
                              WHERE workspace_id=$1 AND job_id=$2 AND site_key=$3))
     ON CONFLICT DO NOTHING`,[lease.workspaceId,lease.jobId,key,JSON.stringify(records),limit]);
  return saved.rowCount;
}

export async function openSiteQueue(lease:JobLease,root:string) {
  const url=siteUrl(root);
  if (!url) throw new AppError(422,'URL de coleta inválida.','INVALID_SITE_URL');
  const key=hash(url);
  await active(lease,client=>enqueue(client,lease,key,[{url:new URL('/robots.txt',url).href,kind:'robots'}]));
  return key;
}

export function claimSiteUrl(lease:JobLease,key:string) {
  return active(lease,async client=>{
    const result=await client.query<SiteClaim>(
      `UPDATE app.prospecting_site_page SET state='processing',claim_fence=$4
       WHERE workspace_id=$1 AND job_id=$2 AND site_key=$3 AND url=(
         SELECT next_page.url FROM app.prospecting_site_page next_page
          WHERE workspace_id=$1 AND job_id=$2 AND site_key=$3
            AND ((state='pending' AND retry_at<=clock_timestamp()) OR (state='processing' AND claim_fence<>$4))
            AND (kind='robots' OR NOT EXISTS (
                 SELECT 1 FROM app.prospecting_site_page robots
                  WHERE robots.workspace_id=$1 AND robots.job_id=$2 AND robots.site_key=$3
                    AND robots.kind='robots' AND robots.state IN ('pending','processing')
                    AND robots.url=split_part(next_page.url,'/',1)||'//'||split_part(next_page.url,'/',3)||'/robots.txt'))
            AND NOT EXISTS (SELECT 1 FROM app.prospecting_site_page current_page
                 WHERE workspace_id=$1 AND job_id=$2 AND site_key=$3 AND state='processing' AND claim_fence=$4)
          ORDER BY priority,retry_at,url LIMIT 1)
       RETURNING url,kind,failures`,[lease.workspaceId,lease.jobId,key,lease.fence]);
    return result.rows[0]??null;
  });
}

export function saveSiteUrl(lease:JobLease,key:string,claim:SiteClaim,result:SitePageResult|null,links:SiteUrl[],
    disposition:{state:'blocked'|'failed'|'retry'; reason:string}|null=null) {
  return active(lease,async client=>{
    const retry=disposition?.state==='retry';
    const state=retry ? claim.failures<2 ? 'pending' : 'failed' : disposition?.state??'completed';
    const reason=disposition?.reason??null;
    const saved=result ? {...result,hash:hash(result.text),fetchedAt:new Date().toISOString()} : null;
    const updated=await client.query(
      `UPDATE app.prospecting_site_page SET state=$6,result=$7,reason=$8,
         failures=failures+CASE WHEN $9 THEN 1 ELSE 0 END,
         retry_at=CASE WHEN $6='pending' THEN clock_timestamp()+make_interval(secs=>5*power(2,failures)) ELSE '-infinity' END
       WHERE workspace_id=$1 AND job_id=$2 AND site_key=$3 AND url=$4 AND claim_fence=$5 AND state='processing'`,
      [lease.workspaceId,lease.jobId,key,claim.url,lease.fence,state,saved,reason,retry]);
    if (!updated.rowCount) throw new AppError(409,'A URL perdeu a autorização da execução.','STALE_JOB');
    if (links.length && state==='completed') await enqueue(client,lease,key,links);
  });
}

export function siteQueueSnapshot(lease:JobLease,key:string,details=true) {
  return active(lease,async client=>(await client.query<SiteRow>(
    `SELECT url,kind,state,failures,retry_at,CASE WHEN $4 OR kind='robots' THEN result
             ELSE result-'text'-'links' END AS result,reason FROM app.prospecting_site_page
     WHERE workspace_id=$1 AND job_id=$2 AND site_key=$3 ORDER BY url`,[lease.workspaceId,lease.jobId,key,details])).rows);
}

export function siteCoverage(rows:SiteRow[]) {
  const pages=rows.filter(row=>row.kind==='page');
  const byUrl=new Map(rows.map(row=>[row.url,row]));
  const unresolvedRedirect=rows.some(row=>{
    const visited=new Set<string>();
    while (row.result?.redirect) {
      if (visited.has(row.url))return true;
      visited.add(row.url);
      const target=byUrl.get(row.result.redirect);
      if (!target||target.state!=='completed')return true;
      row=target;
    }
    return false;
  });
  const pending=rows.filter(row=>row.state==='pending'||row.state==='processing').length;
  return {
    pending,
    completed:pages.filter(row=>row.state==='completed'&&!row.result?.redirect).length,
    blocked:rows.filter(row=>row.state==='blocked').length,
    failed:rows.filter(row=>row.state==='failed').length,
    partial:rows.length>=limit || unresolvedRedirect || rows.some(row=>row.state!=='completed'||row.result?.truncated),
  };
}
