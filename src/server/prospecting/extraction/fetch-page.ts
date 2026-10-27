import http from 'node:http';
import https from 'node:https';
import {gunzipSync,inflateSync,brotliDecompressSync} from 'node:zlib';
import {createHash,randomUUID} from 'node:crypto';
import type {Evidence} from '../../../domain/prospecting.ts';
import {approvePublicUrl,resolvePublicDns} from './public-url.ts';
import type {ApprovedUrl,ResolveDns} from './public-url.ts';
import {parsePage,isContactLink} from './parse-page.ts';
export interface PageResponse{status:number;headers:Record<string,string|undefined>;body:Buffer}
export type PageRequest=(url:ApprovedUrl,signal:AbortSignal)=>Promise<PageResponse>;
const maxBytes=1_048_576;
async function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{const abort=()=>reject(Error('PAGE_TIMEOUT_OR_CANCELLED'));signal.addEventListener('abort',abort,{once:true});promise.then(value=>{signal.removeEventListener('abort',abort);signal.aborted?abort():resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});});
}
export const requestPinned:PageRequest=(approved,signal)=>new Promise((resolve,reject)=>{
  const {url,address,family}=approved;
  const request=(url.protocol==='https:'?https:http).request(url,{
    method:'GET',signal,agent:false,headers:{'user-agent':'PrometeusCadence/0.1 (public company research)','accept':'text/html,text/plain','accept-encoding':'identity'},
    lookup:(_host,options,callback)=>{if(typeof options==='object'&&options.all)callback(null,[{address,family}]);else callback(null,address,family);},
  },response=>{
    const chunks:Buffer[]=[];let size=0;
    response.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){response.destroy(Error('PAGE_TOO_LARGE'));return;}chunks.push(chunk);});
    response.on('error',reject);
    response.on('end',()=>resolve({status:response.statusCode??0,headers:Object.fromEntries(Object.entries(response.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(','):v])),body:Buffer.concat(chunks)}));
  });request.on('error',reject);request.end();
});
export async function fetchPublicPage(value:string,options:{signal:AbortSignal;resolve?:ResolveDns;request?:PageRequest}):Promise<Evidence&{links:string[];socialLinks:string[];externalLinks:string[]}>{
  const signal=AbortSignal.any([options.signal,AbortSignal.timeout(10000)]);let url=value;
  for(let redirects=0;redirects<=3;redirects++){
    signal.throwIfAborted();const approved=await abortable(approvePublicUrl(url,options.resolve??resolvePublicDns),signal);
    const response=await abortable((options.request??requestPinned)(approved,signal),signal);
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
export async function fetchEvidencePack(url:string,options:{signal:AbortSignal;resolve?:ResolveDns;request?:PageRequest},deep=false){
  const pages:Evidence[]=[];const base=new URL(url);base.hash='';
  const urls=[base.toString()];const visited=new Set<string>();
  for(let index=0;index<urls.length&&index<(deep?3:1);index++){
    const next=urls[index];visited.add(next);
    options.signal.throwIfAborted();try{const evidence=await fetchPublicPage(next,options);if(new URL(evidence.url).hostname.replace(/^www\./,'')!==base.hostname.replace(/^www\./,''))continue;pages.push(evidence);
      if(index===0&&deep){const canonical=new URL(evidence.url);for(const link of [...evidence.links.filter(isContactLink),new URL('/sobre',canonical).toString(),new URL('/contato',canonical).toString()])if(!visited.has(link)&&!urls.includes(link))urls.push(link);}
    }catch(error){if(options.signal.aborted)throw error;if(index===0&&deep)urls.push(new URL('/sobre',base).toString(),new URL('/contato',base).toString());}
  }
  // Retain room for contact/about evidence even when the homepage fills the budget.
  let remaining=12000;return pages.map((page,index)=>{const budget=Math.floor(remaining/(pages.length-index)),text=page.text.slice(0,budget);remaining-=text.length;return{...page,text,hash:createHash('sha256').update(text).digest('hex'),truncated:page.truncated||text.length<page.text.length};}).filter(page=>page.text);
}
