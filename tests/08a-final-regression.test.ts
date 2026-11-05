import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {releaseCoverageAccepted,auditRelease,auditReleaseCoverage,sourceHash,sourceRoutes,VIEWPORTS} from '../scripts/lib/release-coverage.ts';

const ok=(route:string,path=route)=>VIEWPORTS.map(v=>({route,viewport:v,ok:true,path,theme:v.endsWith('dark')?'dark':'light'}));

test('08A acceptance needs every required item',()=>{
 assert.equal(releaseCoverageAccepted({required:100,passed:99,criticalFailures:0,unknownUnclassified:0}),false);
 assert.equal(releaseCoverageAccepted({required:100,passed:100,criticalFailures:1,unknownUnclassified:0}),false);
 assert.equal(releaseCoverageAccepted({required:100,passed:100,criticalFailures:0,unknownUnclassified:1}),false);
 assert.equal(releaseCoverageAccepted({required:0,passed:0,criticalFailures:0,unknownUnclassified:0}),false,'an empty registry proves nothing');
 assert.equal(releaseCoverageAccepted({required:100,passed:100,criticalFailures:0,unknownUnclassified:0}),true);
});

test('08A a route passes only with a run in every viewport, never by hand',()=>{
 const exists=()=>true,items=[{id:'/a',kind:'route'},{id:'/b',kind:'route'},{id:'/c',kind:'route'},{id:'/d',kind:'route',status:'passed'}] as never;
 const sweep=[...ok('/a'),...ok('/b').slice(1),...ok('/c').map((r,i)=>i?r:{...r,ok:false})];
 const r=auditRelease(items,sweep,exists);
 assert.equal(r.required,4);assert.equal(r.passed,1);assert.deepEqual(r.failed,['/c']);assert.deepEqual(r.pending,['/b','/d'],'a partial run and a hand-marked route');
});

test('08A journeys and modules need real evidence and a named blocker',()=>{
 const has=(f:string)=>f==='docs/validation/proof.md'||f==='docs/validation/shot.jpg'||f==='package.json',audit=(item:object)=>auditRelease([{id:'x',...item}] as never,[],has);
 assert.equal(audit({kind:'journey',status:'passed',evidence:['docs/validation/proof.md']}).passed,1);
 assert.deepEqual(audit({kind:'journey',status:'passed',evidence:['missing.md']}).pending,['x'],'the file must exist');
 assert.deepEqual(audit({kind:'journey',status:'passed',evidence:['docs/validation/shot.jpg']}).pending,['x'],'a screenshot alone proves no flow');
 assert.deepEqual(audit({kind:'journey',status:'passed'}).pending,['x']);
 assert.deepEqual(audit({kind:'journey',status:'passed',evidence:['package.json']}).pending,['x'],'any existing file is not a validation report');
 assert.deepEqual(audit({kind:'journey',status:'blocked'}).pending,['x'],'blocked needs to say by whom');
 assert.deepEqual(audit({kind:'journey',status:'blocked',blockedBy:'SDR pilot'}).blocked,['x (SDR pilot)']);
 const full={service:true,happy:true,failure:true,recovery:true,externalEffect:'not-applicable'};
 assert.equal(audit({kind:'module',status:'passed',evidence:['docs/validation/proof.md'],proof:full}).passed,1);
 assert.deepEqual(audit({kind:'module',status:'passed',evidence:['docs/validation/proof.md'],proof:{...full,recovery:false}}).pending,['x'],'all of service, happy, failure, recovery');
 assert.deepEqual(audit({kind:'module',status:'passed',evidence:['docs/validation/proof.md'],proof:{...full,externalEffect:undefined}}).pending,['x'],'the external effect is stated');
 assert.deepEqual(audit({kind:'state',status:'reference-unknown',localProof:'docs/validation/proof.md'}).referenceUnknown,['x']);
 const unclassified=audit({kind:'state',status:'reference-unknown'});assert.deepEqual(unclassified.unclassified,['x'],'a reference unknown does not excuse the local function');
 assert.equal(audit({kind:'journey',status:'failed',severity:'critical'}).criticalFailures,1);
 assert.equal(audit({kind:'journey',status:'nonsense'}).pending.length,1);
});

test('08A every page in the app is in the registry',async()=>{
 const routes=sourceRoutes('src/app');assert.ok(routes.includes('/dashboard'));assert.ok(routes.includes('/leads/[id]'));assert.ok(routes.includes('/settings/[[...section]]'));assert.ok(!routes.some(r=>r.includes('(app)')));
 const r=await auditReleaseCoverage({manifestPath:'docs/validation/08-release-matrix.json',evidenceRoot:'docs/validation/evidence/08a-final-regression'});
 assert.deepEqual(r.unregistered,[],'a page without a registry line');assert.deepEqual(r.exceptions,[]);
});

test('08A the command fails on an incomplete registry and lists what is missing',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'08a-')),manifest=path.join(dir,'m.json');writeFileSync(manifest,JSON.stringify({items:[{id:'/dashboard',kind:'route'},{id:'j',kind:'journey',status:'blocked',blockedBy:'Unipile'}]}));
 const run=spawnSync(process.execPath,['scripts/audit-release-coverage.mjs',manifest,dir],{encoding:'utf8'});
 assert.notEqual(run.status,0);assert.match(run.stdout,/\/dashboard/);assert.match(run.stdout,/Unipile/);
});

test('08A a redirect, a fake dark run or a row without the final path is not a pass',()=>{
 const yes=()=>true,run=(item:object,rows:object[])=>auditRelease([{id:'/a',kind:'route',...item}] as never,rows as never,yes);
 assert.equal(run({},ok('/a')).passed,1);
 assert.deepEqual(run({},ok('/a','/login')).failed,['/a'],'landed somewhere else');
 assert.deepEqual(run({},ok('/a').map(({path:_,...r})=>r)).pending,['/a'],'older report without the path');
 assert.equal(run({expectPath:'/b'},ok('/a','/b')).passed,1,'a redirect the registry declares');
 assert.deepEqual(run({},ok('/a').map(r=>({...r,theme:'light'}))).failed,['/a'],'the dark row ran in light');
 assert.equal(run({public:true},ok('/a').map(r=>({...r,theme:'n/a'}))).passed,1,'public pages have no theme');
 assert.equal(run({expectPath:'^/leads/'},ok('/a','/leads/x')).passed,1);
});

test('08A the sweep must match the code it measured and include the isolation proof',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'08a-')),manifest=path.join(dir,'m.json');writeFileSync(manifest,JSON.stringify({items:[{id:'/dashboard',kind:'route',source:'/dashboard'}]}));
 const write=(o:object)=>writeFileSync(path.join(dir,'route-sweep.json'),JSON.stringify({results:ok('/dashboard'),...o}));
 const good=[{account:'a',seesOwn:true,seesOwnById:true,seesOtherInList:false,seesOtherById:false}],run=()=>auditReleaseCoverage({manifestPath:manifest,evidenceRoot:dir});
 write({sourceHash:'old',isolation:good});let r=await run();assert.equal(r.stale,true);assert.equal(r.passed,0,'stale results count for nothing');
 write({sourceHash:sourceHash(),isolation:good});r=await run();assert.equal(r.stale,false);assert.equal(r.passed,1);
 write({sourceHash:sourceHash(),isolation:[{...good[0],seesOtherById:true}]});r=await run();assert.match(r.exceptions.join(),/isolamento/);
 write({sourceHash:sourceHash(),isolation:[{...good[0],seesOwnById:false}]});r=await run();assert.match(r.exceptions.join(),/isolamento/,'a zero without the positive control proves nothing');
 write({sourceHash:sourceHash()});r=await run();assert.match(r.exceptions.join(),/isolamento/);
});

test('08A the registry keeps the required items and every real section',()=>{
 const items:{id:string;kind:string}[]=JSON.parse(readFileSync('docs/validation/08-release-matrix.json','utf8')).items,ids=new Set(items.map(i=>i.id));
 for(const id of ['signup → trial → assinatura','pesquisa → pessoas → qualificação → cadência → inbox e parada','LinkedIn conectado → ação autorizada → conversa','SDR → handoff, agenda e CRM','pacote, renovação e cancelamento','apagar, exportar e fundir dados','API e MCP: escopos e revogação','transversal: popups e menus','transversal: papéis dono, administrador e operador','transversal: teclado e foco','transversal: zoom 200%','transversal: atraso, offline e 503 sem perder rascunho'])assert.ok(ids.has(id),id);
 const settings=/\[([^\]]*'account'[^\]]*)\]\.includes/.exec(readFileSync('src/app/(app)/settings/[[...section]]/page.tsx','utf8'))![1].match(/'[^']+'/g)!.map(s=>s.slice(1,-1));assert.ok(settings.includes('apps/apollo'));
 for(const s of settings)assert.ok(ids.has('/settings/'+s),'/settings/'+s);
 const linkedin=/\[("dashboard"[^\]]*)\]\.includes/.exec(readFileSync('src/app/(app)/linkedin/[[...section]]/page.tsx','utf8'))![1].match(/"[^"]+"/g)!.map(s=>s.slice(1,-1));assert.ok(linkedin.includes('campaigns/new'));
 for(const s of linkedin)assert.ok(ids.has('/linkedin/'+s),'/linkedin/'+s);
 const tabs=[...readFileSync('src/modules/reports/reports.tsx','utf8').matchAll(/\['(\w+)','[^']+','\/reports(?:\/\w+)?'/g)].map(m=>m[1]).filter(t=>t!=='overview');assert.ok(tabs.includes('negocios'));
 for(const t of tabs)assert.ok(ids.has('/reports/'+t),'/reports/'+t);for(const gone of ['/reports/crm','/reports/activity'])assert.ok(!ids.has(gone),gone);
 assert.match(readFileSync('src/app/(app)/reports/[tab]/page.tsx','utf8'),/notFound/,'an invented tab must not render 200');
});
