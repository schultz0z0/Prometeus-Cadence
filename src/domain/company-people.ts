import {z} from 'zod';
import type {EvidenceRef} from './reviewed-operation.ts';
import type {Lead} from './model.ts';
import {normalizePersonalPhone,validateDecisorEvidence} from './enrichment.ts';
import {researchUrl} from './company-research.ts';
export const peopleContractVersion='company-people-v1';
export interface CompanyIdentity{caseId:string;cnpj:string|null;legalName:string|null;state:'resolved'|'conflict'|'missing';evidence:EvidenceRef[]}
export interface PersonContact{kind:'email'|'phone'|'linkedin';value:string;attribution:'personal'|'corporate'|'unresolved';evidence:EvidenceRef[]}
export interface CompanyPerson{id:string;name:string;role:string;relationship:'partner'|'manager'|'unknown';contacts:PersonContact[];current:'supported'|'uncertain';evidence:EvidenceRef[];applied?:boolean}
export interface PeopleApplication{caseId:string;personIds:string[];expectedRevision:number}
export interface PeopleCaseView{id:string;revision:number;state:string;selectedLeadId?:string;companies:{leadId:string;name:string;state:string;missing:string[]}[];identity:CompanyIdentity;people:CompanyPerson[];missing:string[]}
export interface IdentityCandidate{cnpj:string;legalName:string;corroborated:boolean;evidence:EvidenceRef[]}
export interface PeopleAdapters{signal?:AbortSignal;apify?:import('../server/prospecting/providers/types.ts').SourceAdapter;generate?:import('../server/prospecting/ai/decisors.ts').DecisorGenerator;collect?:(url:string,signal:AbortSignal)=>Promise<import('./prospecting.ts').Evidence|null>}
export function classifyPersonContact(input:{attributed:boolean;corporate:boolean;hasSource:boolean}):PersonContact['attribution']{return !input.hasSource?'unresolved':input.corporate?'corporate':input.attributed?'personal':'unresolved';}
const fold=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
export function sanitizePeopleSource(text:string){return text.replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,'[CPF removido]').replace(/\bCPF\s*[:\-]?\s*\d{11}\b/gi,'[CPF removido]').replace(/\b\d{1,3}\s+anos\b/gi,'[idade removida]').slice(0,12000);}
export function resolveIdentityCandidates(caseId:string,company:Partial<Lead>,candidates:IdentityCandidate[]):CompanyIdentity{
 const valid=candidates.filter(c=>c.corroborated&&c.evidence.length&&c.evidence.every(e=>researchUrl(e.url)&&e.quote.trim())),unique=new Map(valid.map(c=>[c.cnpj,c]));
 const selected=unique.size===1?[...unique.values()][0]:null,known=company.cnpj?.replace(/\D/g,'');
 const conflict=unique.size>1||!!(selected&&known&&known!==selected.cnpj);
 return{caseId,state:conflict?'conflict':selected?'resolved':'missing',cnpj:!conflict&&selected?selected.cnpj:null,legalName:!conflict&&selected?selected.legalName:null,evidence:valid.flatMap(c=>c.evidence).slice(0,10)};
}
const proposal=z.object({people:z.array(z.object({name:z.string().trim().min(5).max(200),role:z.string().trim().min(2).max(150),evidenceId:z.string(),quote:z.string().min(10).max(1200),email:z.string().max(254).optional(),phone:z.string().max(40).optional(),linkedin:z.string().max(500).optional()})).max(10)});
export function reviewCompanyPeople(input:{company:Pick<Lead,'id'|'name'>&Partial<Lead>;identity:CompanyIdentity;sources:EvidenceRef[];partners:{name:string;role:string;evidence:EvidenceRef}[];proposed:unknown}):CompanyPerson[]{
 const out=new Map<string,CompanyPerson>(),supported=input.identity.state==='resolved';
 for(const p of input.partners.slice(0,50)){
  if(!researchUrl(p.evidence.url)||!p.evidence.quote.includes(p.name)||p.name.trim().split(/\s+/).length<2)continue;
  const key=fold(p.name);out.set(key,{id:key,name:p.name,role:p.role,relationship:'partner',contacts:[],current:supported?'supported':'uncertain',evidence:[p.evidence]});
 }
 const parsed=proposal.safeParse(input.proposed);if(!parsed.success)return [...out.values()];
 for(const p of parsed.data.people){
  const e=input.sources.find(e=>e.id===p.evidenceId),quote=fold(p.quote),name=fold(p.name),role=fold(p.role);
  if(!e||!researchUrl(e.url)||!e.quote.includes(p.quote)||!quote.includes(name)||!quote.includes(role)||name.split(' ').length<2||!/(socio|fundador|diretor|presidente|gerente|propriet|administr|\bceo\b|\bowner\b|\bfounder\b|\bhead\b|\bpartner\b)/.test(role))continue;
  // A name from QSA alone cannot corroborate employment on a different profile.
  if(![input.company.name,input.company.companyName,input.identity.legalName].some(n=>n&&fold(n).length>=4&&quote.includes(fold(n))))continue;
  const ref={...e,quote:p.quote},key=fold(p.name),prior=out.get(key),contacts:PersonContact[]=[];
  const evidence=[{...e,text:e.quote,truncated:false}];
  for(const kind of ['email','phone','linkedin'] as const){
   const raw=p[kind];if(!raw)continue;const value=kind==='phone'?normalizePersonalPhone(raw):kind==='email'?raw.toLowerCase():researchUrl(raw)?.toString();if(!value)continue;
   const literal=kind==='phone'?(p.quote.match(/(?:\+?55\s*)?\(?\d{2}\)?[\s.-]*\d{4,5}[\s.-]*\d{4}/g)??[]).some(n=>normalizePersonalPhone(n)===value):p.quote.toLowerCase().includes(raw.toLowerCase());if(!literal)continue;
   const corporate=kind==='email'?(value===input.company.email?.toLowerCase()||/^(contato|comercial|atendimento|info|suporte|sac|vendas|financeiro|hello|sales|contact|office)([.+_-]|@)/.test(value)):kind==='phone'?normalizePersonalPhone(input.company.phone)===value:false;
   let attributed=false;try{attributed=kind!=='linkedin'&&validateDecisorEvidence({people:[{name:p.name,role:p.role,evidenceId:e.id,quote:p.quote,[kind]:raw}]},evidence,input.company).length>0;}catch{}
   if(kind==='linkedin')attributed=/^https:\/\/(?:www\.)?linkedin\.com\/in\/[^/]+/.test(value)&&quote.includes(name);
   contacts.push({kind,value,attribution:classifyPersonContact({attributed:supported&&attributed,corporate,hasSource:true}),evidence:[ref]});
  }
  out.set(key,{id:key,name:p.name,role:p.role,relationship:prior?.relationship??'manager',contacts,current:supported?'supported':'uncertain',evidence:prior?[...prior.evidence,ref]:[ref]});
 }
 return [...out.values()].slice(0,50);
}
