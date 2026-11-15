import {workerPool} from '../prospecting/worker-db.ts';
import {geminiEmbed} from '../prospecting/ai/gemini.ts';
import {fuseRanks} from '../../domain/knowledge.ts';
// Hybrid retrieval over the company knowledge base: one embedding call for all queries, vector + text per query, rank fusion.
export interface Passage{id:string;documentId:string;title:string;label:string;text:string}
const MAX_PASSAGES=8,MAX_CHARS=24000;
export async function searchKnowledge(i:{workspaceId:string;documentIds:string[];queries:string[];signal:AbortSignal},deps:{embed?:(texts:string[])=>Promise<{vectors:number[][];inputTokens:number}>}={}):Promise<{passages:Passage[];embedTokens:number}>{
 const queries=[...new Set(i.queries.map(q=>q.trim().slice(0,300)).filter(Boolean))].slice(0,3);
 if(!i.documentIds.length||!queries.length)return {passages:[],embedTokens:0};
 const {vectors,inputTokens}=await(deps.embed??(t=>geminiEmbed(t,'RETRIEVAL_QUERY',i.signal)))(queries);
 const lists:string[][]=[],found=new Map<string,Passage>();
 for(const [n,q] of queries.entries()){
  const rows=(await workerPool().query('SELECT * FROM app.knowledge_search($1,$2,$3,$4,20)',[i.workspaceId,i.documentIds,'['+vectors[n].join(',')+']',q])).rows as {id:string;document_id:string;title:string;label:string;text:string;vector_rank:number|null;text_rank:number|null}[];
  for(const r of rows)found.set(r.id,{id:r.id,documentId:r.document_id,title:r.title,label:r.label,text:r.text});
  for(const key of ['vector_rank','text_rank'] as const)lists.push(rows.filter(r=>r[key]!==null).sort((a,b)=>a[key]!-b[key]!).map(r=>r.id));
 }
 const passages:Passage[]=[];let chars=0;
 for(const id of fuseRanks(lists,60,MAX_PASSAGES)){const p=found.get(id)!;if(chars+p.text.length>MAX_CHARS)break;chars+=p.text.length;passages.push(p);}
 return {passages,embedTokens:inputTokens};
}
