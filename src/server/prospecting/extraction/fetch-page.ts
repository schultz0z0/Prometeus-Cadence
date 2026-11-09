import {gunzipSync,inflateSync,brotliDecompressSync} from 'node:zlib';
import {createHash,randomUUID} from 'node:crypto';
import type {Evidence} from '../../../domain/prospecting.ts';
import {approvePublicUrl,resolvePublicDns} from './public-url.ts';
import type {ApprovedUrl,ResolveDns} from './public-url.ts';
import {parsePage,isContactLink} from './parse-page.ts';
import {extractContacts,extractCnpjs} from './contacts.ts';
import {socialField} from '../../../domain/company-research.ts';
import {loopbackSiteBrowser,siteBrowserUnavailable,type SiteBrowser} from '../site-browser.ts';
import {allows,parseRobots,siteUrl,siteRedirectStatuses} from '../site-policy.ts';
import {ProviderError} from '../providers/transport.ts';
export interface PageResponse{status:number;headers:Record<string,string|undefined>;body:Buffer}
export type PageRequest=(url:ApprovedUrl,signal:AbortSignal)=>Promise<PageResponse>;
const maxBytes=1_048_576;
async function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{const abort=()=>reject(Error('PAGE_TIMEOUT_OR_CANCELLED'));signal.addEventListener('abort',abort,{once:true});promise.then(value=>{signal.removeEventListener('abort',abort);signal.aborted?abort():resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});});
}
type RenderedEvidence=Evidence&{links:string[];socialLinks:string[];externalLinks:string[]};
type ReadOptions={signal:AbortSignal;resolve?:ResolveDns;request?:PageRequest;browser?:SiteBrowser};

function browserReader(browser:SiteBrowser,signal:AbortSignal){
  const policies=new Map<string,Promise<ReturnType<typeof parseRobots>>>();
  const scope=(value:string,base?:string)=>{
    const url=siteUrl(value,base);
    if(!url)throw new ProviderError('URL_BLOCKED');
    return url;
  };
  function robots(origin:string){
    const cached=policies.get(origin);
    if(cached)return cached;
    const pending=(async()=>{
      const root=new URL('/robots.txt',origin).href;
      let url=root;
      for(let i=0;i<6;i++){
        const response=await browser.read('robots',url,signal);
        if(siteRedirectStatuses.includes(response.status)&&response.redirect){url=scope(response.redirect,url);continue;}
        if([404,410].includes(response.status))return parseRobots('');
        if(response.status>=200&&response.status<300)return parseRobots(response.text);
        throw new ProviderError('ROBOTS_UNAVAILABLE',response.status);
      }
      throw new ProviderError('REDIRECT_LIMIT');
    })();
    policies.set(origin,pending);
    return pending;
  }
  return async(value:string):Promise<RenderedEvidence>=>{
    signal.throwIfAborted();
    let url=scope(value);
    for(let i=0;i<6;i++){
      if(!allows(url,(await robots(new URL(url).origin)).rules))throw new ProviderError('ROBOTS_DISALLOWED');
      const page=await browser.read('page',url,signal);
      if(siteRedirectStatuses.includes(page.status)&&page.redirect){url=scope(page.redirect,url);continue;}
      if(page.status!==200)throw new ProviderError('PAGE_HTTP_ERROR',page.status);
      if(page.finalUrl&&scope(page.finalUrl,url)!==url)throw new ProviderError('UNEXPECTED_NAVIGATION');
      const externalLinks=(page.externalLinks??[]).filter(link=>{
        try{const parsed=new URL(link);return ['https:','http:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password;}catch{return false;}
      });
      const socialLinks=externalLinks.filter(link=>socialField(link)).slice(0,10);
      const attributes=(page.contacts??[]).flatMap(link=>{
        try{
          const parsed=new URL(link);
          return ['mailto:','tel:'].includes(parsed.protocol)?[decodeURIComponent(parsed.pathname)]:[];
        }catch{return [];}
      }).join(' ');
      const evidence={id:randomUUID(),url,fetchedAt:new Date().toISOString(),hash:'',text:page.text+' '+attributes,truncated:!!page.truncated};
      const found=extractContacts([evidence]);
      const contacts=[...found.emails,...found.phones,...extractCnpjs([evidence])].join(' ');
      const full=(contacts?'Contatos publicados: '+contacts+'\n':'')+(socialLinks.length?'Links públicos: '+socialLinks.join(' ')+'\n':'')+page.text;
      const text=full.slice(0,12000);
      const links=(page.links??[]).flatMap(link=>{const canonical=siteUrl(link,url);return canonical?[canonical]:[];});
      return {...evidence,text,hash:createHash('sha256').update(text).digest('hex'),truncated:evidence.truncated||text.length<full.length,links,socialLinks,externalLinks};
    }
    throw new ProviderError('REDIRECT_LIMIT');
  };
}

export function fetchPublicPage(value:string,options:ReadOptions):Promise<RenderedEvidence>{
  if(options.request)return readFixturePage(value,{...options,request:options.request});
  return browserReader(options.browser??loopbackSiteBrowser,options.signal)(value);
}

// Keeps the HTML parser available to injected fixture transports only.
async function readFixturePage(value:string,options:ReadOptions&{request:PageRequest}):Promise<RenderedEvidence>{
  const signal=AbortSignal.any([options.signal,AbortSignal.timeout(10000)]);let url=value;
  for(let redirects=0;redirects<=3;redirects++){
    signal.throwIfAborted();const approved=await abortable(approvePublicUrl(url,options.resolve??resolvePublicDns),signal);
    const response=await abortable(options.request(approved,signal),signal);
    if([301,302,303,307,308].includes(response.status)){
      if(!response.headers.location||redirects===3)throw Error('REDIRECT_LIMIT');url=new URL(response.headers.location,approved.url).toString();continue;
    }
    if(response.status!==200)throw Error('PAGE_HTTP_ERROR');
    if(!/^(text\/html|text\/plain|application\/xhtml\+xml)(;|$)/i.test(response.headers['content-type']??''))throw Error('PAGE_MIME');
    if(response.body.length>maxBytes)throw Error('PAGE_TOO_LARGE');
    let body=response.body;
    const encoding=response.headers['content-encoding'];
    if(encoding&&encoding!=='identity'){
      const decode=encoding==='gzip'?gunzipSync:encoding==='deflate'?inflateSync:encoding==='br'?brotliDecompressSync:null;
      if(!decode)throw Error('PAGE_ENCODING');body=decode(body,{maxOutputLength:maxBytes});
    }
    const parsed=parsePage(body.toString('utf8'),approved.url.toString());
    const full=(parsed.contactText?'Contatos publicados: '+parsed.contactText+'\n':'')+(parsed.socialLinks.length?'Links públicos: '+parsed.socialLinks.join(' ')+'\n':'')+parsed.text,text=full.slice(0,12000);
    return{id:randomUUID(),url:approved.url.toString(),fetchedAt:new Date().toISOString(),text,hash:createHash('sha256').update(text).digest('hex'),truncated:full.length>12000,links:parsed.links,socialLinks:parsed.socialLinks,externalLinks:parsed.externalLinks};
  }throw Error('REDIRECT_LIMIT');
}
export async function fetchEvidencePack(url:string,options:ReadOptions,deep=false){
  const read=options.request?(next:string)=>fetchPublicPage(next,options):browserReader(options.browser??loopbackSiteBrowser,options.signal);
  const pages:RenderedEvidence[]=[];const base=new URL(url);base.hash='';
  const urls=[base.toString()];const visited=new Set<string>();
  for(let index=0;index<urls.length&&index<(deep?3:1);index++){
    const next=urls[index];visited.add(next);
    options.signal.throwIfAborted();try{const evidence=await read(next);if(new URL(evidence.url).hostname.replace(/^www\./,'')!==base.hostname.replace(/^www\./,''))continue;pages.push(evidence);
      if(index===0&&deep){const canonical=new URL(evidence.url);for(const link of [...evidence.links.filter(isContactLink),new URL('/sobre',canonical).toString(),new URL('/contato',canonical).toString()])if(!visited.has(link)&&!urls.includes(link))urls.push(link);}
    }catch(error){if(options.signal.aborted||siteBrowserUnavailable(error))throw error;if(index===0&&deep)urls.push(new URL('/sobre',base).toString(),new URL('/contato',base).toString());}
  }
  // Retain room for contact/about evidence even when the homepage fills the budget.
  let remaining=12000;return pages.map((page,index)=>{const budget=Math.floor(remaining/(pages.length-index)),text=page.text.slice(0,budget);remaining-=text.length;return{...page,text,hash:createHash('sha256').update(text).digest('hex'),truncated:page.truncated||text.length<page.text.length};}).filter(page=>page.text);
}
