import test from 'node:test';import assert from 'node:assert/strict';
import {summarizeQualification} from '../src/domain/execution-overview.ts';
import type {ModuleResult} from '../src/domain/prospecting.ts';
// 20/11/2026: what the end-user execution screen shows for a qualification, computed over every item.
const mod=(module:ModuleResult['module'],proposed:Record<string,unknown>,extra:Partial<ModuleResult>={}):ModuleResult=>({module,status:'pending_review',proposed:proposed as any,base:{},reasons:[],evidenceIds:[],usage:null,...extra});
const item=(id:string,qualification:string|null,more:ModuleResult[]=[],applied=false)=>({id,name:'Empresa '+id,leadId:'lead-'+id,applied,createdAt:'2026-11-20T10:00:00.000Z',
 results:[...(qualification?[mod('qualify',{qualification,reason:'Parecer de '+id},{brief:'motivo '+id})]:[]),...more]});
const base={startedAt:'2026-11-20T10:00:00.000Z',now:'2026-11-20T10:30:00.000Z',currentStep:null as string|null};
test('groups by the final proposed qualification',()=>{
 const o=summarizeQualification({...base,total:4,items:[item('a','qualified'),item('b','qualified'),item('c','disqualified'),item('d','pending')]});
 assert.equal(o.groups.ready.count,2);assert.equal(o.groups.outside.count,1);assert.equal(o.groups.noInfo.count,1);
 assert.deepEqual(o.groups.ready.itemIds.sort(),['a','b']);assert.equal(o.items.a.brief,'motivo a');assert.equal(o.items.c.reason,'Parecer de c');
});
test('applied or empty items count as nothing and stay out of the buttons',()=>{
 const o=summarizeQualification({...base,total:3,items:[item('a','qualified',[],true),item('b',null),item('c','qualified')]});
 assert.equal(o.groups.nothing.count,2);
 for(const g of ['ready','noInfo','outside'] as const)assert.ok(!o.groups[g].itemIds.some(id=>id==='a'||id==='b'));
});
test('dots: finished grouped by color, then current, then pending up to total',()=>{
 const o=summarizeQualification({...base,currentStep:'qualify:lead-x',total:5,items:[item('a','qualified'),item('b','disqualified'),item('c','qualified')]});
 assert.deepEqual(o.dots.map(d=>d.group),['ready','ready','outside','current','pending']);
});
test('a finished run has no current dot',()=>{
 const o=summarizeQualification({...base,total:2,items:[item('a','qualified'),item('b','pending')]});
 assert.deepEqual(o.dots.map(d=>d.group),['ready','noInfo']);
});
test('eta is null before 3 finished and rounds up after',()=>{
 assert.equal(summarizeQualification({...base,currentStep:'qualify:x',total:6,items:[item('a','qualified'),item('b','qualified')]}).etaMinutes,null);
 assert.equal(summarizeQualification({...base,currentStep:'qualify:x',total:6,items:[item('a','qualified'),item('b','qualified'),item('c','qualified')]}).etaMinutes,30);
});
test('stage follows the current step',()=>{
 const stage=(currentStep:string|null)=>summarizeQualification({...base,currentStep,total:2,items:[]}).stage;
 assert.equal(stage('qualify:lead1'),'ai');assert.equal(stage('registry:lead1'),'cnpj');assert.equal(stage('evidence:lead1'),'sites');assert.equal(stage('summary:lead1'),'summary');assert.equal(stage(null),null);
});
test('ready totals count new emails, cnpjs and summaries',()=>{
 const o=summarizeQualification({...base,total:2,items:[item('a','qualified',[mod('email',{email:'a@x.com'}),mod('registry',{cnpj:'1'}),mod('summary',{summary:'s'})]),item('b','qualified',[mod('summary',{summary:'s'})])]});
 assert.deepEqual(o.ready,{emails:1,cnpjs:1,summaries:2});assert.deepEqual(o.items.a.found.sort(),['cnpj','email']);
});
test('no-info companies with contacts found are the ones contacts can be saved for',()=>{
 const o=summarizeQualification({...base,total:2,items:[item('a','pending',[mod('email',{email:'a@x.com'})]),item('b','pending')]});
 assert.equal(o.groups.noInfo.count,2);assert.equal(o.noInfo.contacts,1);assert.deepEqual(o.groups.noInfo.itemIds,['a']);
});
