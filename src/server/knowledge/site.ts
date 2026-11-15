import {createHash} from 'node:crypto';
import type {Evidence} from '../../domain/prospecting.ts';
import {chunkSections} from '../../domain/knowledge.ts';
import {workerPool} from '../prospecting/worker-db.ts';
import {geminiEmbed} from '../prospecting/ai/gemini.ts';
import {MAX_DOCUMENT_CHUNKS} from './ingest.ts';
// Each reread of the company site keeps every page read, in full, as an approved knowledge document (one per URL).
// Unchanged pages are not embedded again; pages missing from this read leave the base.
export const SITE_DOCUMENT_CHARS=12*200000;
export type SiteSync={added:number;updated:number;skipped:number;removed:number}|{skipped:'SDR_PLAN'};
export async function syncSiteDocuments(i:{workspaceId:string;userId:string;pages:Evidence[];signal:AbortSignal},deps:{embed?:(texts:string[])=>Promise<{vectors:number[][];inputTokens:number}>}={}):Promise<SiteSync>{
 const state=(await workerPool().query('SELECT app.knowledge_site_pages($1) v',[i.workspaceId])).rows[0].v as {entitled:boolean;pages:Record<string,string>};
 if(!state.entitled)return {skipped:'SDR_PLAN'};
 const embed=deps.embed??(t=>geminiEmbed(t,'RETRIEVAL_DOCUMENT',i.signal)),out:unknown[]=[],seen=new Set<string>();
 for(const page of i.pages){
  const text=page.text.trim(),sha=createHash('sha256').update(text).digest('hex'),url=new URL(page.url);
  if(!text||seen.has(sha))continue;seen.add(sha);
  let path=url.pathname;try{path=decodeURI(path);}catch{}
  const title=(url.hostname.replace(/^www\./,'')+path.replace(/\/$/,'')).slice(0,200);
  const base={url:page.url,title,sha256:sha,bytes:Buffer.byteLength(text)};
  if(state.pages[page.url]===sha){out.push({...base,chunks:null});continue;}
  const chunks=chunkSections([{label:title,text}]);if(!chunks.length||chunks.length>MAX_DOCUMENT_CHUNKS)continue;
  const r=await embed(chunks.map(c=>c.label+'\n'+c.text));if(r.vectors.length!==chunks.length)throw new Error('KNOWLEDGE_EMBED_FAILED');
  out.push({...base,usage:{service:'knowledge',source:'site',embedTokens:r.inputTokens},chunks:chunks.map((c,n)=>({...c,embedding:r.vectors[n]}))});
 }
 i.signal.throwIfAborted();
 return (await workerPool().query('SELECT app.knowledge_sync_site($1,$2,$3) v',[i.workspaceId,i.userId,JSON.stringify(out)])).rows[0].v as SiteSync;
}
