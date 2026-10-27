import test from 'node:test';import assert from 'node:assert/strict';
import {enrichmentBatch} from '../src/domain/enrichment.ts';
test('every unique eligible company remains reachable after the first hundred and duplicate CNPJs cannot occupy two slots',()=>{
 const companies=Array.from({length:101},(_,n)=>({id:'lead-'+String(n).padStart(3,'0'),cnpj:String(n).padStart(14,'0'),listId:'l',qualification:'qualified' as const}));
 const first=enrichmentBatch([...companies,companies[0]],'l',0),second=enrichmentBatch([...companies,companies[0]],'l',1);assert.equal(first.total,101);assert.equal(first.leadIds.length,100);assert.equal(second.leadIds.length,1);assert.equal(new Set([...first.leadIds,...second.leadIds]).size,101);assert.equal(enrichmentBatch(companies,'l',2).leadIds.length,0);
});
