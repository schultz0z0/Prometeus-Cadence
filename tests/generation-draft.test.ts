import test from 'node:test';
import assert from 'node:assert/strict';
import * as drafts from '../src/domain/generation-draft.ts';
const api=drafts as any;
test('audience hypothesis only becomes validated editable filters, without list creation effects',()=>{
 assert.equal(typeof api.audienceOptionToDraft,'function');
 const draft=api.audienceOptionToDraft({source:'MAPS',filters:{term:'dentistas',location:'Recife'},listName:'Dentistas',dailyLimit:20});
 assert.deepEqual(draft,{source:'MAPS',name:'Dentistas',term:'dentistas',location:'Recife',cnae:'',region:'',cnpj:'',limit:20});
 assert.equal(Object.hasOwn(draft,'listId'),false);assert.equal(Object.hasOwn(draft,'automations'),false);
 for(const option of [{source:'MAPS',filters:{term:'x',location:'y',actor:'bad'}},{source:'CNPJ',filters:{term:'x',active:'true'}},{source:'WEB',filters:{term:'x',location:'y',url:'http://localhost'}}])assert.throws(()=>api.audienceOptionToDraft(option));
});
test('CNPJ accepts CNAE search or explicit registry lookup and leaves other sources free of stale CNPJ fields',()=>{
 const make=api.generationFilters;assert.equal(typeof make,'function');
 assert.deepEqual(make({source:'CNPJ',term:'Empresa',location:'',cnae:'',region:'',cnpj:'12.345.678/0001-90'}),{term:'Empresa',cnpj:'12345678000190'});
 assert.deepEqual(make({source:'CNPJ',term:'Público',location:'Recife',cnae:'1234567',region:'PE',cnpj:''}),{term:'Público',location:'Recife',includeCnae:'1234567',states:'PE'});
 assert.deepEqual(make({source:'MAPS',term:'Loja',location:'Recife',cnae:'old',region:'XX',cnpj:'old'}),{term:'Loja',location:'Recife'});
});
