import {randomUUID} from 'node:crypto';
import {workerPool} from '../prospecting/worker-db.ts';
import {localBlobStore} from '../files/local-store.ts';
import type {BlobStore} from '../files/blob-store.ts';
import {chunkSections} from '../../domain/knowledge.ts';
import {extractDocument,type KnowledgeMime} from './extract.ts';
import {geminiEmbed,geminiTranscribePdf} from '../prospecting/ai/gemini.ts';
import {conventionalConfig} from '../prospecting/ai/config.ts';
// Company knowledge base ingestion: a platform service per workspace, outside any AI agent. All chunks or none.
export type IngestDeps={extract?:typeof extractDocument;embed?:(texts:string[])=>Promise<{vectors:number[][];inputTokens:number}>;transcribe?:(bytes:Uint8Array)=>Promise<string>;blobs?:Pick<BlobStore,'get'>};
type Claim={workspaceId:string;id:string;mime:KnowledgeMime;blobKey:string;title:string};
const code=(e:unknown,fallback:string)=>e instanceof Error&&/^KNOWLEDGE_[A-Z_]+$/.test(e.message)?e.message:fallback;
export async function runKnowledgeTick(o:{limit:number;now?:Date;signal?:AbortSignal},deps:IngestDeps={}):Promise<{processed:number}>{
 const pool=workerPool();let processed=0;
 for(;processed<o.limit&&!o.signal?.aborted;processed++){
  const token=randomUUID(),claim=(await pool.query('SELECT app.knowledge_claim_ingest($1,$2) v',[token,o.now??new Date()])).rows[0].v as Claim|null;
  if(!claim)break;
  const signal=AbortSignal.any([AbortSignal.timeout(300000),...(o.signal?[o.signal]:[])]);
  const usage={service:'knowledge',embedTokens:0,transcribeTokens:0};
  const finish=(result:unknown)=>pool.query('SELECT app.knowledge_finish_ingest($1,$2,$3,$4)',[claim.workspaceId,claim.id,token,JSON.stringify(result)]);
  let extracted;
  try{
   const bytes=await(deps.blobs??localBlobStore).get(claim.workspaceId,claim.blobKey);
   const transcribe=deps.transcribe??(async(b:Uint8Array)=>{const r=await geminiTranscribePdf(conventionalConfig(claim.workspaceId).conventional.gemini.route.model,b,signal);usage.transcribeTokens+=(r.inputTokens??0)+(r.outputTokens??0);return r.text;});
   extracted=await(deps.extract??extractDocument)(bytes,claim.mime,{transcribePdf:transcribe});
  }catch(e){await finish({kind:'failed',code:code(e,'KNOWLEDGE_UNREADABLE')});continue;}
  const chunks=chunkSections(extracted.sections);
  if(!chunks.length){await finish({kind:'failed',code:'KNOWLEDGE_EMPTY'});continue;}
  let vectors:number[][];
  try{const r=await(deps.embed??(t=>geminiEmbed(t,'RETRIEVAL_DOCUMENT',signal)))(chunks.map(c=>c.label+'\n'+c.text));vectors=r.vectors;usage.embedTokens=r.inputTokens;
   if(vectors.length!==chunks.length)throw new Error('mismatch');}
  catch{await finish({kind:'failed',code:'KNOWLEDGE_EMBED_FAILED'});continue;}
  await finish({kind:'ready',pages:extracted.pages,usage,chunks:chunks.map((c,i)=>({...c,embedding:vectors[i]}))});
 }
 return {processed};
}
