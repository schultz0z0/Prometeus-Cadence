import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeContextFields} from '../src/domain/context.ts';
import {emptyWorkspace} from '../src/domain/empty-workspace.ts';
test('suggested fields never overwrite text edited during analysis or approve a profile',()=>{
 const base={...emptyWorkspace().companyProfile,offer:'Anterior',name:'Minha empresa',approvedAt:'2026-10-20T12:00:00.000Z'};
 const current={...base,offer:'edição humana feita durante a análise'};
 const suggestion={offer:{value:'Sugerido',quote:'Sugerido',evidenceIds:['page']},name:{value:'Nome novo',quote:'Nome novo',evidenceIds:['page']}};
 const merged=mergeContextFields(base,suggestion,current,['offer','name']);
 assert.equal(merged.draft.offer,'edição humana feita durante a análise');assert.deepEqual(merged.conflicts,['offer']);
 assert.equal(merged.draft.name,'Nome novo');assert.equal(merged.draft.approvedAt,null);
 assert.equal(current.name,'Minha empresa');assert.equal(base.approvedAt,'2026-10-20T12:00:00.000Z');
});
test('unselected fields and metadata survive a merge and matching edits need no conflict',()=>{
 const base=emptyWorkspace().companyProfile,current={...base,offer:'Já aceito'};
 const merged=mergeContextFields(base,{offer:{value:'Já aceito',quote:'',evidenceIds:[]},name:{value:'Não selecionado',quote:'',evidenceIds:[]}},current,['offer']);
 assert.equal(merged.draft.name,current.name);assert.equal(merged.draft.version,current.version);assert.deepEqual(merged.conflicts,[]);
});
