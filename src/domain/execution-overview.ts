import type {ModuleResult} from './prospecting.ts';
// 20/11/2026: what the end-user execution screen shows for a qualification (groups, lot map, progress), computed over every item.
export type LotGroup='ready'|'noInfo'|'outside'|'nothing';
export type LotDot={group:LotGroup|'pending'|'current';name:string};
export type ExecutionStage='sites'|'cnpj'|'ai'|'summary';
export interface QualificationOverview{
 /** false when the run had no fit module: every company with data is one group, "Dados encontrados". */
 fitAssessed:boolean;
 total:number;done:number;etaMinutes:number|null;stage:ExecutionStage|null;dots:LotDot[];
 groups:Record<Exclude<LotGroup,'nothing'>,{count:number;applied:number;itemIds:string[]}>&{nothing:{count:number}};
 ready:{emails:number;cnpjs:number;summaries:number};noInfo:{contacts:number};
 items:Record<string,{name:string;leadId:string|null;brief:string|null;found:('email'|'phone'|'cnpj'|'site')[];reason:string|null}>;
}
/** finished=false: the company is still in analysis (or the run stopped in the middle of it); it is not counted yet. */
export interface OverviewItem{id:string;name:string;leadId:string|null;applied:boolean;results:ModuleResult[];createdAt:string;finished?:boolean}
/** Data that "Salvar os contatos" keeps without touching the qualification (contacts, registry and the summary). */
export const contactFields=['email','phone','site','city','state','cnpj','companyName','capital','size','legalNature','cnae','openedAt','address','summary'];
const order:LotGroup[]=['ready','noInfo','outside','nothing'];
function stageOf(step:string|null):ExecutionStage|null{
 const kind=step?.split(':')[0];if(!kind)return null;
 if(kind==='qualify'||kind==='second_opinion')return 'ai';if(kind==='summary')return 'summary';if(kind==='registry')return 'cnpj';return 'sites';
}
export function summarizeQualification(input:{total:number;items:OverviewItem[];startedAt:string;now:string;currentStep:string|null;fitAssessed?:boolean}):QualificationOverview{
 const fit=input.fitAssessed!==false,groups={ready:{count:0,applied:0,itemIds:[] as string[]},noInfo:{count:0,applied:0,itemIds:[] as string[]},outside:{count:0,applied:0,itemIds:[] as string[]},nothing:{count:0}};
 const ready={emails:0,cnpjs:0,summaries:0},noInfo={contacts:0},items:QualificationOverview['items']={},finished:{group:LotGroup;name:string}[]=[];
 for(const item of input.items){
  if(item.finished===false)continue;
  // An applied item keeps its group (color, counts); it only leaves the buttons.
  const pending=item.results.filter(r=>r.status==='pending_review'),proposed=Object.assign({},...pending.map(r=>r.proposed)) as Record<string,unknown>;
  const qualify=item.results.find(r=>r.module==='qualify'),keys=Object.keys(proposed);
  const found=(['email','phone','cnpj','site'] as const).filter(k=>proposed[k]!==undefined&&proposed[k]!==null&&proposed[k]!==''),contacts=keys.some(k=>contactFields.includes(k));
  const group:LotGroup=!keys.length?'nothing':!fit||proposed.qualification==='qualified'?'ready':proposed.qualification==='disqualified'?'outside':'noInfo';
  items[item.id]={name:item.name,leadId:item.leadId,brief:qualify?.brief??null,found:[...found],reason:typeof qualify?.proposed.reason==='string'?qualify.proposed.reason:null};
  if(group==='nothing')groups.nothing.count++;
  else{
   groups[group].count++;
   if(item.applied)groups[group].applied++;
   else if(group==='noInfo'){if(contacts){groups.noInfo.itemIds.push(item.id);noInfo.contacts++;}}else groups[group].itemIds.push(item.id);
   if(group==='ready'){if(found.includes('email'))ready.emails++;if(found.includes('cnpj'))ready.cnpjs++;if(proposed.summary)ready.summaries++;}
  }
  finished.push({group,name:item.name});
 }
 const done=finished.length,running=input.currentStep!==null;
 const dots:LotDot[]=order.flatMap(g=>finished.filter(f=>f.group===g));
 if(running&&dots.length<input.total)dots.push({group:'current',name:''});
 while(dots.length<input.total)dots.push({group:'pending',name:''});
 const elapsed=Date.parse(input.now)-Date.parse(input.startedAt);
 const etaMinutes=running&&done>=3?Math.ceil(elapsed/done*(input.total-done)/60000):null;
 return {fitAssessed:fit,total:input.total,done,etaMinutes,stage:running?stageOf(input.currentStep):null,dots,groups,ready,noInfo,items};
}
