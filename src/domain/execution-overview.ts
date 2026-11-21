import type {ModuleResult} from './prospecting.ts';
// 20/11/2026: what the end-user execution screen shows for a qualification (groups, lot map, progress), computed over every item.
export type LotGroup='ready'|'noInfo'|'outside'|'nothing';
export type LotDot={group:LotGroup|'pending'|'current';name:string};
export type ExecutionStage='sites'|'cnpj'|'ai'|'summary';
export interface QualificationOverview{
 kind:'qualification';
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
 return {kind:'qualification',fitAssessed:fit,total:input.total,done,etaMinutes,stage:running?stageOf(input.currentStep):null,dots,groups,ready,noInfo,items};
}

// 21/11/2026: stage 2 — generation runs. Companies enter the list on their own; the screen shows what came in and the next step.
export const discoveryReasonLabels:Record<string,string>={
 CNPJ_OUTSIDE_SCOPE:'CNPJ fora do recorte ou sem situação ativa confirmada',
 CNPJ_OUTSIDE_DATE_WINDOW:'Data de abertura fora da faixa consultada ou indisponível',
 CNPJ_ALREADY_EXAMINED:'CNPJ já examinado nesta busca',
 MAPS_IDENTITY_UNVERIFIED:'Estabelecimento sem correspondência confirmada no Maps',
 SITE_IDENTITY_UNVERIFIED:'Site institucional sem vínculo confirmado',
 MISSING_IDENTITY:'Registro sem identificação suficiente',
 NOT_A_COMPANY_SITE:'Resultado de lista, diretório ou rede social, não site de empresa',
};
export type GenerationDotGroup='new'|'dup'|'out';
type Found='phone'|'site'|'email'|'cnpj'|'rating';
export interface GenerationOverview{kind:'generation';source:'MAPS'|'WEB'|'CNPJ'|'APOLLO';listId:string|null;listName:string|null;target:number;examined:number;etaMinutes:number|null;stage:'search'|'maps'|'site'|'save'|null;
 dots:{group:GenerationDotGroup|'pending'|'current';name:string}[];
 created:{count:number;phones:number;sites:number;ratings:number;emails:number;cnpjs:number;companies:{leadId:string;name:string;city:string|null;found:Found[]}[]};
 duplicates:{count:number;names:string[]};discarded:{count:number;reasons:{label:string;count:number}[]}}
export type ExecutionOverview=QualificationOverview|GenerationOverview;
const filled=(v:unknown)=>v!==undefined&&v!==null&&String(v).trim()!=='';
export function summarizeGeneration(input:{source:GenerationOverview['source'];listId:string|null;listName:string|null;target:number;counts:{inserted:number;duplicates:number;rejected:number};reasons:Record<string,number>;
 created:{leadId:string;name:string;city?:string;phone?:string;site?:string;email?:string;cnpj?:string;rating?:string}[];duplicateNames:string[];startedAt:string;now:string;running:boolean;currentStep:string|null}):GenerationOverview{
 const {inserted,duplicates,rejected}=input.counts,examined=inserted+duplicates+rejected;
 const dots:GenerationOverview['dots']=[...Array(inserted).fill('new'),...Array(duplicates).fill('dup'),...Array(rejected).fill('out')].map(group=>({group,name:''}));
 if(input.running){if(dots.length<input.target)dots.push({group:'current',name:''});while(dots.length<input.target)dots.push({group:'pending',name:''});}
 const companies=input.created.map(c=>({leadId:c.leadId,name:c.name,city:filled(c.city)?c.city!:null,found:(['phone','site','email','cnpj','rating'] as const).filter(k=>filled(c[k]))}));
 const count=(k:Found)=>companies.filter(c=>c.found.includes(k)).length;
 const elapsed=Date.parse(input.now)-Date.parse(input.startedAt);
 const etaMinutes=input.running&&examined>=3?Math.max(1,Math.ceil(elapsed/examined*Math.max(0,input.target-inserted)/60000)):null;
 const kind=input.currentStep?.split(':')[0]??'';
 const stage=!input.running?null:examined===0?'search':kind==='maps'?'maps':['website','verify-site','evidence'].includes(kind)?'site':'save';
 return {kind:'generation',source:input.source,listId:input.listId,listName:input.listName,target:input.target,examined,etaMinutes,stage,dots,
  created:{count:inserted,phones:count('phone'),sites:count('site'),ratings:count('rating'),emails:count('email'),cnpjs:count('cnpj'),companies},
  duplicates:{count:duplicates,names:input.duplicateNames},
  discarded:{count:rejected,reasons:Object.entries(input.reasons).map(([code,n])=>({label:discoveryReasonLabels[code]??code,count:n}))}};
}
