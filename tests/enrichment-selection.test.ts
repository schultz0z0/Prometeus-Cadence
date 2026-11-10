import test from 'node:test';import assert from 'node:assert/strict';
import {enrichmentBatch} from '../src/domain/enrichment.ts';
test('every unique eligible company remains reachable after the first hundred and duplicate CNPJs cannot occupy two slots',()=>{
 const companies=Array.from({length:101},(_,n)=>({id:'lead-'+String(n).padStart(3,'0'),cnpj:String(n).padStart(14,'0'),listId:'l',qualification:'qualified' as const}));
 const first=enrichmentBatch([...companies,companies[0]],'l',0),second=enrichmentBatch([...companies,companies[0]],'l',1);assert.equal(first.total,101);assert.equal(first.leadIds.length,100);assert.equal(second.leadIds.length,1);assert.equal(new Set([...first.leadIds,...second.leadIds]).size,101);assert.equal(enrichmentBatch(companies,'l',2).leadIds.length,0);
});
test('06B.7 the standard batch needs a qualified company with CNPJ and the missing-CNPJ investigation is a separate batch',async()=>{
 const {missingCnpjBatch}=await import('../src/domain/enrichment.ts'),{readFileSync}=await import('node:fs');
 const leads=[{id:'a',listId:'l',qualification:'qualified',cnpj:'37.297.479/0001-80'},{id:'b',listId:'l',qualification:'pending',cnpj:'11222333000181'},{id:'c',listId:'l',qualification:'qualified'},{id:'d',listId:'l',qualification:'pending'},{id:'e',listId:'other',qualification:'pending'}];
 assert.deepEqual(enrichmentBatch(leads,'l',0),{total:1,leadIds:['a']});
 assert.deepEqual(missingCnpjBatch(leads,'l',0),{total:2,leadIds:['c','d']});
 const screen=readFileSync(new URL('../src/modules/prospecting/enrichment.tsx',import.meta.url),'utf8');
 assert.match(screen,/enrichmentBatch\(/);assert.match(screen,/missingCnpjBatch\(/);
 assert.match(screen,/\.\.\.\(investigating\?\{companyPeople:true\}:\{\}\)/,'only the separate investigation uses the companyPeople flow');
 assert.doesNotMatch(screen,/com ou sem CNPJ/);
});
