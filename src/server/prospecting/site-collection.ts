import type {JobLease} from '../../domain/prospecting.ts';
import {loopbackSiteBrowser,siteBrowserUnavailable,type SiteBrowser} from './site-browser.ts';
import {claimSiteUrl,openSiteQueue,saveSiteUrl,siteCoverage,siteQueueSnapshot,type SitePageResult,type SiteUrl} from './site-queue.ts';
import {ProviderError} from './providers/transport.ts';
import {siteUrl,parseRobots,allows,siteRedirectStatuses} from './site-policy.ts';
export type {SiteBrowser} from './site-browser.ts';

function sitemapLinks(text:string):SiteUrl[] {
  const kind=/^\s*(?:<\?xml[^>]*>\s*)?<sitemapindex(?:\s|>)/i.test(text)?'sitemap':'page';
  const entry=kind==='sitemap'?'sitemap':'url';
  const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
  // Parse the direct loc of each standard sitemap entry. Never expand XML entities or extensions.
  const entries=new RegExp('<'+entry+'(?:\\s[^>]*)?>\\s*<loc(?:\\s[^>]*)?>\\s*([^<]+?)\\s*</loc>','gi');
  return Array.from(text.matchAll(entries),match=>({kind,url:match[1].replace(/&(amp|lt|gt|quot|apos);/g,(_,key:string)=>entities[key])}));
}

function frontier(root:string,base:string,items:SiteUrl[]) {
  const urls=new Map<string,SiteUrl>();
  for (const item of items) {
    const url=siteUrl(item.url,base);
    if (!url||!siteUrl(url,root))continue;
    const robots=new URL('/robots.txt',url).href;
    if(item.kind!=='robots')urls.set(robots,{kind:'robots',url:robots});
    urls.set(url,{...item,url});
  }
  return [...urls.values()];
}

export async function collectSiteTick(lease:JobLease,root:string,browser:SiteBrowser=loopbackSiteBrowser,signal:AbortSignal=AbortSignal.timeout(35000)){
  signal.throwIfAborted();
  const key=await openSiteQueue(lease,root);
  const claim=await claimSiteUrl(lease,key);
  if (claim) {
    const rows=await siteQueueSnapshot(lease,key,false);
    const origin=new URL(claim.url).origin;
    const robots=rows.find(row=>row.kind==='robots'&&new URL(row.url).origin===origin);
    const rules=robots?.result?.text?parseRobots(robots.result.text).rules:[];
    const permitted=claim.kind==='robots'||(robots?.state==='completed'&&allows(claim.url,rules));
    if (!permitted){
      await saveSiteUrl(lease,key,claim,null,[],{state:'blocked',reason:robots?.state==='completed'?'ROBOTS_DISALLOWED':'ROBOTS_UNAVAILABLE'});
    } else {
      let result:SitePageResult|null=null;
      let failure:{state:'blocked'|'failed'|'retry';reason:string}|null=null;
      let links:SiteUrl[]=[];
      try {
        result=await browser.read(claim.kind,claim.url,signal);
        // Metadata redirects keep the original policy identity. Chromium redirects are queued as a new URL.
        if (claim.kind==='robots') {
          let current=claim.url;
          const visited=new Set([current]);
          while (siteRedirectStatuses.includes(result.status)){
            const target=result.redirect&&siteUrl(result.redirect,current);
            if(!target||!siteUrl(target,root)||visited.has(target)||visited.size>=6)break;
            visited.add(target);
            result=await browser.read('robots',target,signal);
            current=target;
          }
        }
        const status=result.status;
        if(status===408||status===429||status>=500)failure={state:'retry',reason:'HTTP_'+status};
        else if(siteRedirectStatuses.includes(status)&&claim.kind!=='robots'){
          const redirect=result.redirect&&siteUrl(result.redirect,claim.url);
          if(redirect&&siteUrl(redirect,root)){
            result={...result,redirect};
            links=[{kind:claim.kind,url:redirect}];
          }
          else failure={state:'blocked',reason:'REDIRECT_BLOCKED'};
        }else if (status>=200&&status<300){
          if (claim.kind==='robots'){
            const {sitemaps}=parseRobots(result.text);
            const first=new URL(root).origin===origin;
            links=[...(first?[{url:root,kind:'page' as const}]:[]),...(sitemaps.length?sitemaps:['/sitemap.xml']).map(url=>({url,kind:'sitemap' as const}))];
          }else if (claim.kind==='sitemap') links=sitemapLinks(result.text);
          else if (result.finalUrl&&siteUrl(result.finalUrl,claim.url)!==claim.url)failure={state:'blocked',reason:'UNEXPECTED_NAVIGATION'};
          else links=(result.links??[]).map(url=>({kind:'page',url}));
        }else if (claim.kind==='robots'&&[404,410].includes(status)){
          result={status,text:''};
          links=[...(new URL(root).origin===origin?[{url:root,kind:'page' as const}]:[]),{kind:'sitemap',url:'/sitemap.xml'}];
        }else if(claim.kind==='sitemap'&&[404,410].includes(status)) result={status,text:''};
        else failure={state:'failed',reason:'HTTP_'+status};
      }catch(error){
        if(signal.aborted||siteBrowserUnavailable(error))throw error;
        if(!(error instanceof ProviderError))throw error;
        failure={state:error.status>=500||error.status===429?'retry':error.code==='URL_BLOCKED'?'blocked':'failed',reason:error.code};
      }
      signal.throwIfAborted();
      await saveSiteUrl(lease,key,claim,result,frontier(root,claim.url,links),failure);
    }
  }
  const rows=await siteQueueSnapshot(lease,key,false);
  const coverage=siteCoverage(rows);
  if(coverage.pending){
    const scheduled=claim?[]:rows.flatMap(row=>row.state==='pending'&&row.retry_at instanceof Date&&row.retry_at.getTime()>Date.now()?[row.retry_at.getTime()]:[]);
    return {done:false,coverage,pages:[],retryAt:scheduled.length?new Date(Math.min(...scheduled)).toISOString():null};
  }
  const completed=await siteQueueSnapshot(lease,key);
  return {done:true,coverage,retryAt:null,pages:completed.flatMap(row=>{
    const page=row.result;
    return row.kind==='page'&&row.state==='completed'&&page&&page.status>=200&&page.status<300?[{url:row.url,...page}]:[];
  })};
}
