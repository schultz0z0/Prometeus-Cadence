import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
export const VIEWPORTS=['1920','1440','768','390','320','390-dark'];
export interface ReleaseItem {id:string;kind:'route'|'journey'|'module'|'state';source?:string;expectPath?:string;public?:boolean;noShell?:boolean;status?:string;evidence?:string[];blockedBy?:string;severity?:string;localProof?:string;proof?:{service?:boolean;happy?:boolean;failure?:boolean;recovery?:boolean;externalEffect?:string};}
export interface SweepResult {route:string;viewport:string;ok:boolean;path?:string;theme?:string;}
export interface ReleaseCoverageReport {required:number;passed:number;failed:string[];blocked:string[];pending:string[];referenceUnknown:string[];unclassified:string[];criticalFailures:number;exceptions:string[];unregistered:string[];stale:boolean;}
export const releaseCoverageAccepted=(i:{required:number;passed:number;criticalFailures:number;unknownUnclassified:number})=>i.required>0&&i.passed===i.required&&i.criticalFailures===0&&i.unknownUnclassified===0;
// A picture shows a state, not that the flow ran; and only a validation report counts, not any file that happens to exist.
const proves=(file:string,exists:(f:string)=>boolean)=>file.startsWith('docs/validation/')&&exists(file)&&!/\.(jpe?g|png|webp|gif)$/i.test(file);
/** Where a visit must end: the route itself, or what the registry declares (a leading ^ makes it a pattern). */
const landed=(item:ReleaseItem,p:string)=>{const e=item.expectPath??item.id;return e.startsWith('^')?new RegExp(e).test(p):p===e;};
export function auditRelease(items:ReleaseItem[],sweep:SweepResult[],exists:(file:string)=>boolean):ReleaseCoverageReport{
 const r:ReleaseCoverageReport={required:items.length,passed:0,failed:[],blocked:[],pending:[],referenceUnknown:[],unclassified:[],criticalFailures:0,exceptions:[],unregistered:[],stale:false},seen=new Set<string>();
 for(const item of items){
  if(seen.has(item.id))r.exceptions.push('duplicated: '+item.id);seen.add(item.id);
  if(item.kind==='route'){
   // Only the sweep's report decides a route; a status typed in the registry means nothing.
   const runs=sweep.filter(s=>s.route===item.id);
   if(runs.some(s=>!s.ok||(s.path!==undefined&&!landed(item,s.path))||(s.viewport.endsWith('dark')&&s.theme!==(item.public||item.noShell?'n/a':'dark')))){r.failed.push(item.id);continue;}
   if(VIEWPORTS.every(v=>runs.some(s=>s.viewport===v&&s.path!==undefined)))r.passed++;else r.pending.push(item.id);
   continue;
  }
  if(item.status==='failed'){r.failed.push(item.id);if(item.severity==='critical')r.criticalFailures++;continue;}
  if(item.status==='blocked'&&item.blockedBy){r.blocked.push(`${item.id} (${item.blockedBy})`);continue;}
  if(item.status==='reference-unknown'){
   if(item.localProof&&proves(item.localProof,exists)){r.referenceUnknown.push(item.id);r.passed++;}else r.unclassified.push(item.id);
   continue;
  }
  const p=item.proof,complete=item.kind!=='module'||!!(p?.service&&p.happy&&p.failure&&p.recovery&&p.externalEffect);
  if(item.status==='passed'&&complete&&item.evidence?.some(f=>proves(f,exists)))r.passed++;else r.pending.push(item.id);
 }
 return r;
}
/** Every page.tsx as its route pattern, route groups removed. */
export function sourceRoutes(appDir:string):string[]{
 const out:string[]=[];const walk=(dir:string,route:string)=>{for(const e of readdirSync(dir,{withFileTypes:true})){
  if(e.isDirectory())walk(path.join(dir,e.name),/^\(.*\)$/.test(e.name)?route:route+'/'+e.name);
  else if(e.name==='page.tsx')out.push(route||'/');
 }};walk(appDir,'');return out.sort();
}
/** The code a sweep measured. Line endings are normalized because Git may rewrite them. */
export function sourceHash(root='src'):string{
 const hash=createHash('sha256');const walk=(dir:string)=>{for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:1)){
  const file=path.join(dir,e.name);if(e.isDirectory())walk(file);else{hash.update(file.replaceAll('\\','/'));hash.update(readFileSync(file,'utf8').replaceAll('\r\n','\n'));}
 }};walk(root);return hash.digest('hex');
}
export async function auditReleaseCoverage(input:{manifestPath:string;evidenceRoot:string}):Promise<ReleaseCoverageReport>{
 const items:ReleaseItem[]=JSON.parse(readFileSync(input.manifestPath,'utf8')).items,sweepFile=path.join(input.evidenceRoot,'route-sweep.json');
 const sweep=existsSync(sweepFile)?JSON.parse(readFileSync(sweepFile,'utf8')):null,stale=!!sweep&&sweep.sourceHash!==sourceHash();
 // Results measured on other code count for nothing.
 const report=auditRelease(items,!sweep||stale?[]:sweep.results,existsSync),sources=new Set(items.map(i=>i.source));
 report.stale=stale;
 report.unregistered=sourceRoutes('src/app').filter(r=>r!=='/'&&!sources.has(r));
 const isolation=sweep?.isolation;
 if(sweep&&!stale&&!(isolation?.length&&isolation.every((i:Record<string,boolean>)=>i.seesOwn&&i.seesOwnById&&!i.seesOtherInList&&!i.seesOtherById)))report.exceptions.push('isolamento entre contas não comprovado');
 return report;
}
