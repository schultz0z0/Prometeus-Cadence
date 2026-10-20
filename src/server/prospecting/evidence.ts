import type {PoolClient} from 'pg';
import type {Evidence} from '../../domain/prospecting.ts';
import type {Principal} from '../../domain/workspace.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {hashValue} from './review.ts';
import {randomUUID} from 'node:crypto';
export async function saveEvidence(c:PoolClient,jobId:string,leadId:string,evidence:Evidence[]){
  const ids:string[]=[];
  for(const item of evidence.slice(0,3)){
    const url=new URL(item.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)continue;
    const text=item.text.slice(0,12000),id=randomUUID();
    await c.query("INSERT INTO app.lead_evidence(workspace_id,id,lead_id,job_id,url,text,hash,truncated,fetched_at) VALUES(current_setting('app.workspace_id'),$1,$2,$3,$4,$5,$6,$7,$8)",[id,leadId,jobId,url.toString(),text,hashValue(text),item.truncated||item.text.length>12000,item.fetchedAt]);ids.push(id);
  }return ids;
}
export async function loadEvidence(p:Principal,ids:string[]):Promise<Evidence[]>{
  return withWorkspaceTransaction(p,async c=>(await c.query('SELECT * FROM app.lead_evidence WHERE id=ANY($1::text[]) LIMIT 1500',[ids.slice(0,1500)])).rows.map(r=>({id:r.id,url:r.url,text:r.text,hash:r.hash,truncated:r.truncated,fetchedAt:new Date(r.fetched_at).toISOString()})));
}
