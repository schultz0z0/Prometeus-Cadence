import test,{after,beforeEach} from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';
import {resetRateLimits} from './helpers.ts';
import {prospectingUser,testAdmin,closeProspectingPools} from './prospecting-helpers.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {workerPool} from '../../src/server/prospecting/worker-db.ts';
import type {Principal} from '../../src/domain/workspace.ts';
after(closeProspectingPools);beforeEach(resetRateLimits);
const pro=(p:Principal)=>testAdmin(c=>c.query("UPDATE app.billing_account SET state='active',plan='pro',period_start=now(),period_end=now()+interval '30 days' WHERE workspace_id=$1",[p.workspaceId]));
async function company(){const u=await prospectingUser({billing:false});await pro(u.p);return u;}
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
export const vec=(seed:number)=>'['+Array.from({length:1536},(_,i)=>i===seed%1536?1:0).join(',')+']';
export const register=(p:Principal,name:string)=>withWorkspaceTransaction(p,async c=>(await c.query('SELECT * FROM app.knowledge_register($1,$2,$3,$4,$5)',[name,'text/csv',10,sha(name+p.workspaceId),randomUUID()])).rows[0]);
export async function ingestReady(chunks:{label:string;text:string;seed:number}[]){
 const token=randomUUID(),claim=(await workerPool().query('SELECT app.knowledge_claim_ingest($1,now()) v',[token])).rows[0].v;
 const result={kind:'ready',pages:1,usage:{service:'knowledge'},chunks:chunks.map((c,i)=>({ordinal:i,label:c.label,text:c.text,embedding:JSON.parse(vec(c.seed))}))};
 assert.equal((await workerPool().query('SELECT app.knowledge_finish_ingest($1,$2,$3,$4) v',[claim.workspaceId,claim.id,token,JSON.stringify(result)])).rows[0].v,'READY');
 return claim as {workspaceId:string;id:string};
}
const approve=(p:Principal,id:string)=>withWorkspaceTransaction(p,async c=>{const r=(await c.query('SELECT revision FROM app.knowledge_document WHERE id=$1',[id])).rows[0];return (await c.query('SELECT * FROM app.knowledge_set_state($1,$2,$3)',[id,r.revision,'approved'])).rows[0];});
async function drain(){await testAdmin(c=>c.query("UPDATE app.knowledge_document SET state='archived' WHERE state IN('uploaded','processing')"));}
test('knowledge: owners register, others cannot, limits and duplicates hold',async()=>{
 await drain();const u=await company();
 const d=await register(u.p,'precos.csv');assert.equal(d.state,'uploaded');
 await assert.rejects(()=>register(u.p,'precos.csv'),/KNOWLEDGE_DUPLICATE/);
 const op=await prospectingUser({billing:false});
 await testAdmin(c=>c.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',[randomUUID(),u.p.workspaceId,op.p.userId,'operator']));
 await assert.rejects(()=>register({...op.p,workspaceId:u.p.workspaceId},'outro.csv'),/SDR_ACCESS/);
 await testAdmin(c=>c.query("INSERT INTO app.knowledge_document(workspace_id,title,mime,bytes,sha256,blob_key,uploaded_by,state) SELECT $1,'f'||g,'text/csv',1,md5(g::text)||md5(g::text),gen_random_uuid()::text,$2,'failed' FROM generate_series(1,49) g",[u.p.workspaceId,u.p.userId]));
 await assert.rejects(()=>register(u.p,'cinquenta-e-um.csv'),/KNOWLEDGE_LIMIT/);
});
test('knowledge: only ready documents can be approved and a foreign lease cannot finish',async()=>{
 await drain();const u=await company(),d=await register(u.p,'script.csv');
 await assert.rejects(()=>withWorkspaceTransaction(u.p,c=>c.query('SELECT app.knowledge_set_state($1,$2,$3)',[d.id,d.revision,'approved'])),/KNOWLEDGE_STATE/);
 const claim=(await workerPool().query('SELECT app.knowledge_claim_ingest($1,now()) v',[randomUUID()])).rows[0].v;assert.equal(claim.id,d.id);
 assert.equal((await workerPool().query('SELECT app.knowledge_finish_ingest($1,$2,$3,$4) v',[claim.workspaceId,claim.id,'not-the-lease',JSON.stringify({kind:'failed',code:'X'})])).rows[0].v,'STALE');
});
test('knowledge: another workspace never reads or finds the chunks',async()=>{
 await drain();const a=await company(),b=await company(),d=await register(a.p,'apresentacao.csv');
 await ingestReady([{label:'Preços',text:'Plano Essencial custa R$ 900 por mês. Código ABC-123.',seed:7}]);
 await approve(a.p,d.id);
 assert.equal(await withWorkspaceTransaction(b.p,async c=>Number((await c.query('SELECT count(*) FROM app.knowledge_chunk')).rows[0].count)),0);
 assert.equal(await withWorkspaceTransaction(b.p,async c=>Number((await c.query('SELECT count(*) FROM app.knowledge_document')).rows[0].count)),0);
 const own=await workerPool().query('SELECT * FROM app.knowledge_search($1,$2,$3,$4,20)',[a.p.workspaceId,[d.id],vec(7),'ABC-123']);
 assert.equal(own.rows.length,1);assert.equal(own.rows[0].vector_rank,1);assert.equal(own.rows[0].text_rank,1);
 const foreign=await workerPool().query('SELECT * FROM app.knowledge_search($1,$2,$3,$4,20)',[b.p.workspaceId,[d.id],vec(7),'ABC-123']);
 assert.equal(foreign.rows.length,0);
 await assert.rejects(()=>withWorkspaceTransaction(b.p,c=>c.query('SELECT app.knowledge_search($1,$2,$3,$4,20)',[a.p.workspaceId,[d.id],vec(7),'x'])));
});
