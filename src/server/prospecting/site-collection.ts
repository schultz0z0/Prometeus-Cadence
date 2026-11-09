import type {JobLease} from '../../domain/prospecting.ts';
import {loopbackSiteBrowser,type SiteBrowser} from './site-browser.ts';
import {claimSiteUrl,openSiteQueue,saveSiteUrl,siteCoverage,siteQueueSnapshot,siteUrl,type SitePageResult,type SiteUrl} from './site-queue.ts';
import {ProviderError} from './providers/transport.ts';
export type {SiteBrowser} from './site-browser.ts';

type Rule={allow:boolean; pattern:string};
const normalized=(value:string)=>encodeURI(value).replace(/%25([\dA-F]{2})/gi,(_,hex:string)=>{
  const char=String.fromCharCode(parseInt(hex,16));
  return /[\w.~-]/.test(char)?char:'%'+hex.toUpperCase();
});

function parseRobots(text:string) {
  const groups:{agents:string[]; rules:Rule[]}[]=[];
  const sitemaps:string[]=[];
  let group:typeof groups[number]|undefined;
  let afterRules=false;
  for (const line of text.split(/\r?\n/)) {
    const [,raw='',value='']=line.split('#',1)[0].match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/)??[];
    const field=raw.toLowerCase();
    if (field==='sitemap'&&value)sitemaps.push(value);
    if (field==='user-agent') {
      if(!group||afterRules){group={agents:[],rules:[]};groups.push(group);afterRules=false;}
      group.agents.push(value.toLowerCase());
    }
    if (group&&(field==='allow'||field==='disallow')) {
      afterRules=true;
      if(value.startsWith('/'))group.rules.push({allow:field==='allow',pattern:normalized(value)});
    }
  }
  const exact=groups.filter(item=>item.agents.includes('prometeuscadence'));
  const chosen=exact.length?exact:groups.filter(item=>item.agents.includes('*'));
  return {rules:chosen.flatMap(item=>item.rules),sitemaps};
}

// Match in linear passes over path segments. A remote robots.txt cannot inject a regular expression.
function matches(path:string,pattern:string) {
  const anchored=pattern.endsWith('$');
  const [prefix,...middle]=(anchored?pattern.slice(0,-1):pattern).split('*');
  if (!path.startsWith(prefix))return false;
  if (!middle.length)return !anchored||path===prefix;
  const suffix=anchored?middle.pop()!:'';
  if (!path.endsWith(suffix))return false;
  const body=path.slice(prefix.length,path.length-suffix.length);
  let offset=0;
  for (const part of middle) {
    const found=body.indexOf(part,offset);
    if (found<0)return false;
    offset=found+part.length;
  }
  return path.length>=prefix.length+suffix.length+offset;
}

function allows(url:string,rules:Rule[]) {
  const {pathname,search}=new URL(url), path=normalized(pathname+search);
  let best:Rule|undefined;
  for (const rule of rules) {
    if (best && (rule.pattern.length<best.pattern.length ||
        (rule.pattern.length===best.pattern.length&&best.allow)))continue;
    if (matches(path,rule.pattern))best=rule;
  }
  return best?.allow??true;
}

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

const redirectStatuses=[301,302,303,307,308];

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
          while (redirectStatuses.includes(result.status)){
            const target=result.redirect&&siteUrl(result.redirect,current);
            if(!target||!siteUrl(target,root)||visited.has(target)||visited.size>=6)break;
            visited.add(target);
            result=await browser.read('robots',target,signal);
            current=target;
          }
        }
        const status=result.status;
        if(status===408||status===429||status>=500)failure={state:'retry',reason:'HTTP_'+status};
        else if(redirectStatuses.includes(status)&&claim.kind!=='robots'){
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
        if(signal.aborted)throw error;
        if(!(error instanceof ProviderError))throw error;
        failure={state:error.status>=500||error.status===429?'retry':error.code==='URL_BLOCKED'?'blocked':'failed',reason:error.code};
      }
      signal.throwIfAborted();
      await saveSiteUrl(lease,key,claim,result,frontier(root,claim.url,links),failure);
    }
  }
  const rows=await siteQueueSnapshot(lease,key,false);
  const coverage=siteCoverage(rows);
  if(coverage.pending)return {done:false,coverage,pages:[]};
  const completed=await siteQueueSnapshot(lease,key);
  return {done:true,coverage,pages:completed.flatMap(row=>{
    const page=row.result;
    return row.kind==='page'&&row.state==='completed'&&page&&page.status>=200&&page.status<300?[{url:row.url,...page}]:[];
  })};
}
