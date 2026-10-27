import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';
const root=process.cwd(),base='docs/superpowers/',prefix='2026-10-27-prometeus-cadence-';
const manifest=JSON.parse(fs.readFileSync(base+'plans/'+prefix+'implementation-manifest.json','utf8'));
const files=['specs/'+prefix+'complete-prd.md','specs/'+prefix+'technical-contracts.md','plans/'+prefix+'master-plan.md',...new Set(manifest.packages.flatMap(p=>[p.plan.slice(base.length),p.spec.slice(base.length)]))].map(f=>base+f);
const errors=[],warnings=[],seen=new Set(),ids=new Set(manifest.packages.map(p=>p.id));
const done=new Set(['02','03','04','05','06A-P','06A-H','06B.1','06B.2','06C.1','06IA']);
for(const p of manifest.packages){
 if(seen.has(p.id))errors.push('duplicate:'+p.id);seen.add(p.id);
 for(const d of p.dependencies)if(!ids.has(d)&&!done.has(d))errors.push('unknown dependency:'+p.id+'→'+d);
 const text=fs.readFileSync(p.plan,'utf8');
 for(const heading of ['**Goal:**','**Architecture:**','**Tech Stack:**','**Spec:**','## Global Constraints','## Review Focus','## File Structure','## Interfaces e dados','### Task 1:','### Task 2:','### Task 3:','## Self-review'])if(!text.includes(heading))errors.push(p.id+' missing '+heading);
 if((text.match(/- \[ \]/g)||[]).length<12)errors.push('too few actionable steps:'+p.id);
 for(const f of p.modify)if(!fs.existsSync(f)&&!manifest.packages.some(x=>x.create.includes(f)))errors.push('unresolved file:'+p.id+':'+f);
 if(!text.includes(p.unit)||!text.includes(p.integration))errors.push('missing test command:'+p.id);
}
const active=new Set(),visited=new Set();function visit(id){if(active.has(id)){errors.push('dependency cycle:'+id);return;}if(visited.has(id))return;active.add(id);for(const d of manifest.packages.find(p=>p.id===id).dependencies)if(ids.has(d))visit(d);active.delete(id);visited.add(id);}for(const id of ids)visit(id);
const rq=new Set(manifest.packages.flatMap(p=>p.requirements));for(let n=1;n<=26;n++)if(!rq.has('R'+String(n).padStart(2,'0')))errors.push('requirement uncovered:R'+n);
for(const f of files){
 const t=fs.readFileSync(f,'utf8');
 for(const [,snippet]of t.matchAll(/```ts\n([\s\S]*?)\n```/g)){
  const parsed=ts.createSourceFile(f,snippet,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  for(const diagnostic of parsed.parseDiagnostics)errors.push('TypeScript syntax:'+f+':'+ts.flattenDiagnosticMessageText(diagnostic.messageText,' '));
 }
if((t.match(/^```/gm)||[]).length%2)errors.push('unbalanced fence:'+f);
 if(/\b(?:TBD|TODO)\b/.test(t)||/implementar depois|a definir/.test(t))errors.push('undefined scope:'+f);
 for(const [,raw]of t.matchAll(/\]\(([^)]+)\)/g)){
  if(/^(https?:|mailto:|#)/.test(raw))continue;const ref=decodeURIComponent(raw.replace(/#.*$/,''));const target=path.resolve(path.dirname(f),ref);
  if(!fs.existsSync(target))errors.push('broken link:'+f+'→'+ref);
 }
}
const report={date:'2026-10-27',kind:'documentation-only',packages:manifest.packages.length,requirements:rq.size,areaSpecs:new Set(manifest.packages.map(p=>p.spec)).size,documents:files.length,dependencyCycle:errors.some(e=>e.startsWith('dependency cycle:')),errors,warnings,productTestsRun:false};
fs.mkdirSync('docs/validation/evidence/planning-2026-10-27',{recursive:true});fs.writeFileSync('docs/validation/evidence/planning-2026-10-27/verification.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));if(errors.length)process.exitCode=1;
