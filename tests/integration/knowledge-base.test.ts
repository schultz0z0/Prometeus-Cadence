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
test('ingestion: a document becomes ready with all its chunks, or fails with none',async()=>{
 const {runKnowledgeTick}=await import('../../src/server/knowledge/ingest.ts');
 const unit=(texts:string[])=>({vectors:texts.map((_,i)=>Array.from({length:1536},(_,j)=>j===i%1536?1:0)),inputTokens:texts.length});
 const blobs={get:async()=>new TextEncoder().encode('x'),put:async()=>{},remove:async()=>{}};
 const chunks=(id:string)=>testAdmin(async c=>Number((await c.query('SELECT count(*) FROM app.knowledge_chunk WHERE document_id=$1',[id])).rows[0].count));
 const doc=(id:string)=>testAdmin(async c=>(await c.query('SELECT state,error,chunks,usage FROM app.knowledge_document WHERE id=$1',[id])).rows[0]);
 await drain();const u=await company();
 const ok=await register(u.p,'ok.csv');
 await runKnowledgeTick({limit:1},{blobs,extract:async()=>({pages:1,sections:[{label:'Preços',text:'Plano A custa R$ 900. '.repeat(400)}]}),embed:async t=>unit(t)});
 const d1=await doc(ok.id);assert.equal(d1.state,'ready');assert.ok(d1.chunks>1);assert.equal(await chunks(ok.id),d1.chunks);assert.equal(d1.usage.service,'knowledge');
 const bad=await register(u.p,'bad.csv');
 await runKnowledgeTick({limit:1},{blobs,extract:async()=>{throw new Error('KNOWLEDGE_UNREADABLE');},embed:async t=>unit(t)});
 assert.deepEqual([(await doc(bad.id)).state,(await doc(bad.id)).error,await chunks(bad.id)],['failed','KNOWLEDGE_UNREADABLE',0]);
 const lost=await register(u.p,'lost.csv');
 await runKnowledgeTick({limit:1},{blobs,extract:async()=>({pages:1,sections:[{label:'x',text:'texto '.repeat(50)}]}),embed:async()=>{throw new Error('provider down');}});
 assert.deepEqual([(await doc(lost.id)).state,(await doc(lost.id)).error,await chunks(lost.id)],['failed','KNOWLEDGE_EMBED_FAILED',0]);
 const retry=await register(u.p,'retry.csv');
 await workerPool().query('SELECT app.knowledge_claim_ingest($1,now())',[randomUUID()]);
 await testAdmin(c=>c.query("UPDATE app.knowledge_document SET lease_until=now()-interval '1 minute' WHERE id=$1",[retry.id]));
 await runKnowledgeTick({limit:1},{blobs,extract:async()=>({pages:1,sections:[{label:'x',text:'retomado'}]}),embed:async t=>unit(t)});
 assert.equal((await doc(retry.id)).state,'ready');
});
test('documents api: upload, list by any member, type and size checks, removal, isolation',async()=>{
 const svc=await import('../../src/server/knowledge/service.ts');
 const files=new Map<string,Uint8Array>(),store={put:async(_w:string,k:string,b:Uint8Array)=>{files.set(k,b);},get:async(_w:string,k:string)=>files.get(k)!,remove:async(_w:string,k:string)=>{files.delete(k);}};
 await drain();const a=await company(),b=await company();
 const doc=await svc.uploadDocument(a.p,{name:'precos.csv',bytes:new TextEncoder().encode('Serviço;Preço\nSDR;R$ 900\n')},{store});
 assert.deepEqual([doc.state,doc.mime,doc.title],['uploaded','text/csv','precos.csv']);assert.equal(files.size,1);
 const op=await prospectingUser({billing:false});
 await testAdmin(c=>c.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',[randomUUID(),a.p.workspaceId,op.p.userId,'operator']));
 const opP={...op.p,workspaceId:a.p.workspaceId};
 assert.equal((await svc.listDocuments(opP)).documents.length,1);
 await assert.rejects(svc.uploadDocument(opP,{name:'x.csv',bytes:new TextEncoder().encode('a;b\n1;2\n')},{store}),{status:403});
 await assert.rejects(svc.uploadDocument(a.p,{name:'virus.pdf',bytes:new Uint8Array([77,90,144,0,3,0])},{store}),{status:422});
 await assert.rejects(svc.uploadDocument(a.p,{name:'grande.csv',bytes:new Uint8Array(10485761).fill(65)},{store}),{status:413});
 await assert.rejects(svc.uploadDocument(a.p,{name:'precos.csv',bytes:new TextEncoder().encode('Serviço;Preço\nSDR;R$ 900\n')},{store}),{status:409});
 assert.equal(files.size,1,'a refused upload leaves no file behind');
 await assert.rejects(svc.setDocumentState(b.p,doc.id,{expectedRevision:doc.revision,state:'archived'}),{status:404});
 await svc.deleteDocument(a.p,doc.id,{store});
 assert.equal(files.size,0);assert.equal((await svc.listDocuments(a.p)).documents.length,0);
});
test('documents http: oversized or non-multipart bodies are refused before reading',async()=>{
 const {knowledgeRequest}=await import('../../src/server/knowledge/http.ts');const {base}=await import('./helpers.ts');
 const u=await company(),h=new Headers(u.headers);h.set('x-cadence-workspace',u.p.workspaceId);
 assert.equal((await knowledgeRequest(new Request(base+'/api/knowledge/documents'))).status,401);
 const big=new Headers(h);big.set('content-type','multipart/form-data; boundary=x');big.set('content-length',String(12*1024*1024));
 assert.equal((await knowledgeRequest(new Request(base+'/api/knowledge/documents',{method:'POST',headers:big,body:'x'}))).status,413);
 const plain=new Headers(h);plain.set('content-type','application/json');
 assert.equal((await knowledgeRequest(new Request(base+'/api/knowledge/documents',{method:'POST',headers:plain,body:'{}'}))).status,422);
 const ok=await knowledgeRequest(new Request(base+'/api/knowledge/documents',{headers:h}));assert.equal(ok.status,200);assert.deepEqual((await ok.json()).documents,[]);
});
test('search: filtered vector search still fills k, exact text wins, only approved documents, never another workspace',async()=>{
 const {searchKnowledge}=await import('../../src/server/knowledge/search.ts');
 await drain();const a=await company(),b=await company();
 const noisy=await register(b.p,'outra-empresa.csv');
 await ingestReady(Array.from({length:300},(_,i)=>({label:'B',text:'Conteúdo da outra empresa '+i,seed:0})));await approve(b.p,noisy.id);
 const own=await register(a.p,'nossa.csv');
 await ingestReady([...Array.from({length:24},(_,i)=>({label:'A',text:'Serviço comum número '+i,seed:i+1})),{label:'Tabela',text:'Código ABC-123 custa R$ 900',seed:999}]);await approve(a.p,own.id);
 const raw=await workerPool().query('SELECT * FROM app.knowledge_search($1,$2,$3,$4,20)',[a.p.workspaceId,[own.id],vec(0),'']);
 assert.equal(raw.rows.filter(r=>r.vector_rank!==null).length,20,'iterative scan fills k despite closer rows of another workspace');
 let embedCalls=0;const embed=async(t:string[])=>{embedCalls++;return {vectors:t.map(()=>JSON.parse(vec(0))),inputTokens:1};};
 const r=await searchKnowledge({workspaceId:a.p.workspaceId,documentIds:[own.id],queries:['código ABC-123'],signal:AbortSignal.timeout(5000)},{embed});
 assert.equal(embedCalls,1);assert.ok(r.passages.length<=8);const hit=r.passages.find(x=>/ABC-123/.test(x.text));assert.ok(hit,'the exact code is found even with a distant vector');assert.equal(hit.title,'nossa.csv');
 assert.equal((await searchKnowledge({workspaceId:b.p.workspaceId,documentIds:[own.id],queries:['ABC-123'],signal:AbortSignal.timeout(5000)},{embed})).passages.length,0);
 const draftDoc=await register(a.p,'rascunho.csv');await ingestReady([{label:'R',text:'Código XYZ-777 ainda não aprovado',seed:5}]);
 assert.equal((await searchKnowledge({workspaceId:a.p.workspaceId,documentIds:[draftDoc.id],queries:['XYZ-777'],signal:AbortSignal.timeout(5000)},{embed})).passages.length,0);
 await withWorkspaceTransaction(a.p,async c=>{const r2=(await c.query('SELECT revision FROM app.knowledge_document WHERE id=$1',[own.id])).rows[0];await c.query("SELECT * FROM app.knowledge_set_state($1,$2,'archived')",[own.id,r2.revision]);});
 assert.equal((await searchKnowledge({workspaceId:a.p.workspaceId,documentIds:[own.id],queries:['ABC-123'],signal:AbortSignal.timeout(5000)},{embed})).passages.length,0);
 embedCalls=0;assert.deepEqual((await searchKnowledge({workspaceId:a.p.workspaceId,documentIds:[],queries:['x'],signal:AbortSignal.timeout(5000)},{embed})).passages,[]);assert.equal(embedCalls,0);
});
