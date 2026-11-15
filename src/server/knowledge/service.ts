import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {localBlobStore} from '../files/local-store.ts';
import type {BlobStore} from '../files/blob-store.ts';
import type {KnowledgeMime} from './extract.ts';
// Company knowledge base: documents belong to the workspace; owners/admins manage them, every member reads the list.
export interface KnowledgeDocumentView{id:string;revision:number;title:string;mime:string;bytes:number;state:'uploaded'|'processing'|'ready'|'approved'|'failed'|'archived';error:string|null;pages:number|null;chunks:number|null;approvedAt:string|null;createdAt:string;sourceUrl:string|null}
const failures:Record<string,[number,string]>={
 SDR_ACCESS:[403,'Seu papel não permite esta alteração.'],
 SDR_PLAN:[409,'A base de conhecimento da empresa faz parte do plano Pro com assinatura ativa.'],
 KNOWLEDGE_LIMIT:[422,'Você chegou ao limite de 50 documentos neste workspace.'],
 KNOWLEDGE_DUPLICATE:[409,'Este arquivo já está na base.'],
 KNOWLEDGE_NOT_FOUND:[404,'Documento não encontrado neste workspace.'],
 KNOWLEDGE_CHANGED:[409,'Este documento mudou desde que você abriu. Recarregue e revise de novo.'],
 KNOWLEDGE_STATE:[409,'Só um documento pronto pode ser aprovado.'],
};
const tx=<T,>(p:Principal,fn:(c:PoolClient)=>Promise<T>)=>withWorkspaceTransaction(p,fn).catch(e=>{const k=e instanceof Error?failures[e.message]:undefined;throw k?new AppError(k[0],k[1],e.message):e;});
const view=(r:Record<string,any>):KnowledgeDocumentView=>({id:r.id,revision:Number(r.revision),title:r.title,mime:r.mime,bytes:Number(r.bytes),state:r.state,error:r.error,pages:r.pages,chunks:r.chunks,approvedAt:r.approved_at?.toISOString()??null,createdAt:r.created_at.toISOString(),sourceUrl:r.source_url??null});
const types:Record<string,KnowledgeMime>={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',csv:'text/csv',txt:'text/plain',md:'text/markdown'};
/** Type comes from the extension and must match the first bytes; text types must be valid UTF-8 without NUL. */
export function knowledgeMime(name:string,bytes:Uint8Array):KnowledgeMime|null{
 const mime=types[name.toLowerCase().split('.').pop()??''];if(!mime)return null;
 const starts=(sig:number[])=>sig.every((b,i)=>bytes[i]===b);
 if(mime==='application/pdf')return starts([0x25,0x50,0x44,0x46])?mime:null;
 if(mime.startsWith('application/vnd.openxmlformats'))return starts([0x50,0x4b,0x03,0x04])?mime:null;
 if(bytes.includes(0))return null;try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);return mime;}catch{return null;}
}
export async function listDocuments(p:Principal){return tx(p,async c=>{
 const role=(await c.query('SELECT app.current_role() r')).rows[0].r as string|null;if(!role)throw new AppError(403,failures.SDR_ACCESS[1]);
 return {canManage:['owner','admin'].includes(role),documents:(await c.query("SELECT * FROM app.knowledge_document WHERE state<>'archived' ORDER BY created_at DESC,id")).rows.map(view)};
});}
export async function uploadDocument(p:Principal,file:{name:string;bytes:Uint8Array},deps:{store?:BlobStore}={}):Promise<KnowledgeDocumentView>{
 if(file.bytes.length>10485760)throw new AppError(413,'O arquivo passa de 10 MB.');
 if(!file.bytes.length)throw new AppError(422,'O arquivo está vazio.');
 const mime=knowledgeMime(file.name,file.bytes);if(!mime)throw new AppError(422,'Envie PDF, Word, Excel, CSV, TXT ou Markdown.');
 const title=file.name.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,200)||'Documento',key=randomUUID(),store=deps.store??localBlobStore;
 const sha=createHash('sha256').update(file.bytes).digest('hex');
 await store.put(p.workspaceId,key,file.bytes);
 try{return await tx(p,async c=>view((await c.query('SELECT * FROM app.knowledge_register($1,$2,$3,$4,$5)',[title,mime,file.bytes.length,sha,key])).rows[0]));}
 catch(e){await store.remove(p.workspaceId,key).catch(()=>{});throw e;}
}
const stateInput=z.strictObject({expectedRevision:z.number().int().positive(),state:z.enum(['approved','archived'])});
export async function setDocumentState(p:Principal,id:string,raw:unknown):Promise<KnowledgeDocumentView>{
 const b=stateInput.safeParse(raw);if(!b.success||!z.uuid().safeParse(id).success)throw new AppError(422,'Operação inválida.');
 return tx(p,async c=>view((await c.query('SELECT * FROM app.knowledge_set_state($1,$2,$3)',[id,b.data.expectedRevision,b.data.state])).rows[0]));
}
export async function deleteDocument(p:Principal,id:string,deps:{store?:BlobStore}={}){
 if(!z.uuid().safeParse(id).success)throw new AppError(422,'Operação inválida.');
 const key=await tx(p,async c=>(await c.query('SELECT app.knowledge_delete($1) k',[id])).rows[0].k as string);
 await(deps.store??localBlobStore).remove(p.workspaceId,key).catch(()=>{});return {deleted:true};
}
export async function previewDocument(p:Principal,id:string){
 if(!z.uuid().safeParse(id).success)throw new AppError(422,'Operação inválida.');
 return tx(p,async c=>{
  if(!(await c.query('SELECT 1 FROM app.knowledge_document WHERE id=$1',[id])).rowCount)throw new AppError(404,failures.KNOWLEDGE_NOT_FOUND[1]);
  return {chunks:(await c.query('SELECT ordinal,label,text FROM app.knowledge_chunk WHERE document_id=$1 ORDER BY ordinal LIMIT 5',[id])).rows as {ordinal:number;label:string;text:string}[]};
 });
}
