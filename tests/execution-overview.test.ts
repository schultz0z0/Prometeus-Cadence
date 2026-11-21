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
test('empty items count as nothing; applied ones keep their group but leave the buttons',()=>{
 const o=summarizeQualification({...base,total:3,items:[item('a','qualified',[],true),item('b',null),item('c','qualified')]});
 assert.equal(o.groups.nothing.count,1);assert.equal(o.groups.ready.count,2);assert.equal(o.groups.ready.applied,1);
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
test('an item still in analysis is not counted as done',()=>{
 const partial={...item('x',null,[mod('website',{site:'https://x.example'})]),finished:false};
 const o=summarizeQualification({...base,currentStep:'evidence:lead-x',total:3,items:[item('a','qualified'),partial]});
 assert.equal(o.done,1);assert.deepEqual(o.dots.map(d=>d.group),['ready','current','pending']);assert.equal(o.groups.noInfo.count,0);
});
test('the last company in analysis keeps the run live',()=>{
 const o=summarizeQualification({...base,currentStep:'qualify:lead-b',total:2,items:[item('a','qualified'),{...item('b',null,[mod('email',{email:'b@x.com'})]),finished:false}]});
 assert.equal(o.stage,'ai');assert.deepEqual(o.dots.map(d=>d.group),['ready','current']);
});
test('a cancelled run leaves unfinished companies hollow and out of every group',()=>{
 const o=summarizeQualification({...base,total:3,items:[item('a','qualified'),{...item('b',null,[mod('email',{email:'b@x.com'})]),finished:false}]});
 assert.deepEqual(o.dots.map(d=>d.group),['ready','pending','pending']);assert.equal(o.groups.noInfo.count,0);
});
test('a run without the fit module puts every company with data in one group',()=>{
 const o=summarizeQualification({...base,fitAssessed:false,total:2,items:[item('a',null,[mod('summary',{summary:'s'})]),item('b',null)]});
 assert.equal(o.fitAssessed,false);assert.deepEqual(o.groups.ready.itemIds,['a']);assert.equal(o.groups.nothing.count,1);
});
test('no-info companies with only a summary can be saved too',()=>{
 const o=summarizeQualification({...base,total:1,items:[item('a','pending',[mod('summary',{summary:'s'})])]});
 assert.deepEqual(o.groups.noInfo.itemIds,['a']);
});
// 21/11/2026: stage 2 — generation runs (Maps, web, CNPJ, Apollo).
import {summarizeGeneration} from '../src/domain/execution-overview.ts';
const gen=(over:Partial<Parameters<typeof summarizeGeneration>[0]>={})=>summarizeGeneration({source:'MAPS',listId:'l1',listName:'Esquadrias SC',target:6,counts:{inserted:0,duplicates:0,rejected:0},reasons:{},created:[],duplicateNames:[],startedAt:'2026-11-21T10:00:00.000Z',now:'2026-11-21T10:10:00.000Z',running:true,currentStep:null,...over});
test('generation dots: new, duplicates, discarded, then current and pending up to target',()=>{
 assert.deepEqual(gen({counts:{inserted:2,duplicates:1,rejected:1},currentStep:'start'}).dots.map(d=>d.group),['new','new','dup','out','current','pending']);
});
test('a finished generation has no pending dots even with more discarded than the target',()=>{
 const o=gen({target:2,running:false,counts:{inserted:2,duplicates:0,rejected:5}});
 assert.equal(o.dots.length,7);assert.ok(!o.dots.some(d=>d.group==='pending'||d.group==='current'));assert.equal(o.examined,7);
});
test('generation totals and found count only filled values',()=>{
 const o=gen({running:false,counts:{inserted:2,duplicates:0,rejected:0},created:[{leadId:'a',name:'A',city:'Joinville',phone:'+554799',site:'https://a.example/',rating:'4.8'},{leadId:'b',name:'B',phone:'+554788',site:''}]});
 assert.equal(o.created.phones,2);assert.equal(o.created.sites,1);assert.equal(o.created.ratings,1);assert.equal(o.created.emails,0);
 assert.deepEqual(o.created.companies[0].found,['phone','site','rating']);assert.equal(o.created.companies[1].city,null);
});
test('discard reasons use the plain labels',()=>{
 assert.deepEqual(gen({reasons:{NOT_A_COMPANY_SITE:2,X_UNKNOWN:1}}).discarded.reasons,[{label:'Resultado de lista, diretório ou rede social, não site de empresa',count:2},{label:'X_UNKNOWN',count:1}]);
});
test('generation stage',()=>{
 assert.equal(gen({currentStep:'start'}).stage,'search');
 assert.equal(gen({counts:{inserted:1,duplicates:0,rejected:0},currentStep:'maps:lead:registry-first'}).stage,'maps');
 assert.equal(gen({counts:{inserted:1,duplicates:0,rejected:0},currentStep:'website:x:admission'}).stage,'site');
 assert.equal(gen({counts:{inserted:1,duplicates:0,rejected:0},currentStep:'start'}).stage,'save');
 assert.equal(gen({running:false,counts:{inserted:1,duplicates:0,rejected:0}}).stage,null);
});
test('qualification overview carries kind',()=>assert.equal(summarizeQualification({...base,total:0,items:[]}).kind,'qualification'));
