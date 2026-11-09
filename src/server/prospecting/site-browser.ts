import {gunzipSync} from 'node:zlib';
import {z} from 'zod';
import {ProviderError} from './providers/transport.ts';
import type {SitePageResult,SiteUrl} from './site-queue.ts';

export interface SiteBrowser {
  read(kind:SiteUrl['kind'],url:string,signal:AbortSignal):Promise<SitePageResult>;
}

const responseStatus=z.number().int().min(100).max(599);
const documentSchema=z.object({url:z.string().max(1800),status:responseStatus,text:z.string().max(24000),
  links:z.array(z.string()).max(500),truncated:z.boolean()});
const rawSchema=z.object({status:responseStatus,headers:z.record(z.string(),z.string()),body:z.string().max(1_400_000)});
const redirectSchema=z.object({status:responseStatus,redirect:z.string().max(1800)});
const errors=z.object({code:z.string().regex(/^[A-Z_]+$/).max(60)});
const agent='PrometeusCadence/1.0 (public company research)';

export function siteBrowserReady(){return (process.env.SITE_BROWSER_TOKEN?.length??0)>=32;}

export const loopbackSiteBrowser:SiteBrowser={
  async read(kind,url,signal){
    if(!siteBrowserReady())throw new ProviderError('SITE_BROWSER_NOT_CONFIGURED',503);
    const render=kind==='page';
    let response;
    try {
      response=await fetch('http://127.0.0.1:3222/'+(render?'render':'fetch'),{
        method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(30000)]),
        headers:{authorization:'Bearer '+process.env.SITE_BROWSER_TOKEN,'content-type':'application/json'},
        body:JSON.stringify(render?{url,timeoutMs:25000,queueNavigation:true}:{url,method:'GET',headers:{'user-agent':agent}}),
      });
    } catch(error) {
      if(signal.aborted)throw error;
      throw new ProviderError('SITE_BROWSER_UNAVAILABLE',503);
    }
    const raw:unknown=await response.json().catch(()=>null);
    if(!response.ok)throw new ProviderError(errors.safeParse(raw).data?.code??'SITE_BROWSER_UNAVAILABLE',response.status);
    if(render){
      const redirect=redirectSchema.safeParse(raw);
      if(redirect.success)return {...redirect.data,text:''};
      const parsed=documentSchema.safeParse(raw);
      if(!parsed.success)throw new ProviderError('INVALID_BROWSER_RESPONSE');
      const {url:finalUrl,...page}=parsed.data;
      return {...page,text:page.text.replaceAll('\0',''),finalUrl};
    }
    const parsed=rawSchema.safeParse(raw);
    if(!parsed.success)throw new ProviderError('INVALID_BROWSER_RESPONSE');
    const {status,headers,body}=parsed.data;
    if(status>=300&&status<400)return {status,text:'',redirect:headers.location};
    if(status<200||status>=300)return {status,text:''};
    let bytes:Uint8Array=Buffer.from(body,'base64');
    const encoding=headers['content-encoding']?.trim().toLowerCase()??'identity';
    if(encoding!=='identity'&&encoding!=='gzip')throw new ProviderError('INVALID_COMPRESSED_DOCUMENT');
    if(encoding==='gzip'||(bytes[0]===0x1f&&bytes[1]===0x8b)){
      try {bytes=gunzipSync(bytes,{maxOutputLength:1_048_576});}
      catch {throw new ProviderError('INVALID_COMPRESSED_DOCUMENT');}
    }
    try {
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replaceAll('\0','');
      return {status,text};
    }catch {throw new ProviderError('INVALID_METADATA_ENCODING');}
  },
};
