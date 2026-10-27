import {z} from 'zod';
import type {Evidence,JobState,UsageEstimate} from './prospecting.ts';
import type {Lead} from './model.ts';
import type {EvidenceRef} from './reviewed-operation.ts';
import {extractContacts} from '../server/prospecting/extraction/contacts.ts';

export const researchContractVersion='company-research-v1';
export const researchOptionsSchema=z.strictObject({sourceKinds:z.array(z.enum(['website','social','registry'])).min(1).max(3).refine(v=>new Set(v).size===v.length),maxPagesPerCompany:z.number().int().min(1).max(10)});
const id=z.string().min(1).max(120).refine(v=>!/[\x00-\x1f]/.test(v));
export const companyResearchInputSchema=researchOptionsSchema.extend({leadIds:z.array(id).min(1).max(500).refine(v=>new Set(v).size===v.length)});
export type CompanyResearchInput=z.infer<typeof companyResearchInputSchema>;
export type ResearchOptions=z.infer<typeof researchOptionsSchema>;
export type ResearchKind=ResearchOptions['sourceKinds'][number];
export type ResearchField='email'|'phone'|'site'|'summary'|'instagram'|'facebook'|'linkedin'|'address'|'companyName';
export interface ResearchPage extends Evidence{links?:string[];externalLinks?:string[];socialLinks?:string[];corroborated?:boolean;sourceKind?:ResearchKind}
export interface ResearchFact{id:string;leadId:string;field:ResearchField;value:string;evidence:EvidenceRef[];attribution:'company'|'uncertain';applied?:boolean}
export interface ResearchSourceView{id:string;leadId:string;url:string;fetchedAt:string;hash:string;sourceKind:ResearchKind;attribution:'company'|'uncertain'}
export interface ResearchCaseView{id:string;revision:number;state:JobState;facts:ResearchFact[];missing:string[];sources:ResearchSourceView[];selectedLeadId?:string;totalCompanies:number;companies:{leadId:string;name:string;state:string;missing:string[]}[];usage?:UsageEstimate[]}
export interface ResearchApplication{caseId:string;factIds:string[];expectedRevision:number}
export interface ResearchAdapters{signal?:AbortSignal;collect?:(source:ResearchKind,urls:string[],signal:AbortSignal)=>Promise<ResearchPage[]>;apify?:import('../server/prospecting/providers/types.ts').SourceAdapter}
export function parseCompanyResearchInput(value:unknown):CompanyResearchInput{return companyResearchInputSchema.parse(value);}

export function researchUrl(value:string):URL|null{
 try{const u=new URL(/^https?:\/\//i.test(value)?value:`https://${value}`);if(!/^https?:$/.test(u.protocol)||u.username||u.password||!u.hostname.includes('.')||/(^|\.)(localhost|local|internal|test)$/i.test(u.hostname)||/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname)||/^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)||u.hostname.includes(':')||u.port&&!['80','443'].includes(u.port))return null;u.hash='';return u;}catch{return null;}
}
function host(value:string){return researchUrl(value)?.hostname.toLowerCase().replace(/^www\./,'')??'';}
export function matchCompanySource(input:{companyDomain:string;candidateDomain:string;corroborated:boolean}):'matched'|'review'{
 const company=host(input.companyDomain),candidate=host(input.candidateDomain);
 if(!candidate)return'review';if(input.corroborated)return'matched';if(!company)return'review';
 if(['instagram.com','facebook.com','m.facebook.com','linkedin.com','twitter.com','x.com','youtube.com'].includes(company)){
  const base=researchUrl(input.companyDomain)!,target=researchUrl(input.candidateDomain)!;
  const path=base.pathname.replace(/\/$/,'');
  return path&&candidate===company&&(target.pathname.replace(/\/$/,'')===path||target.pathname.startsWith(path+'/'))?'matched':'review';
 }
 return candidate===company||candidate.endsWith('.'+company)?'matched':'review';
}
export function socialField(value:string):'instagram'|'facebook'|'linkedin'|null{
 const u=researchUrl(value);if(!u)return null;const h=u.hostname.replace(/^www\./,'');
 if(!u.pathname.replaceAll('/','')||/\/(sharer|share|intent|login|accounts|search)(\/|$)/i.test(u.pathname))return null;
 if(h==='instagram.com')return'instagram';if(h==='facebook.com'||h==='m.facebook.com')return'facebook';
 if(h==='linkedin.com'&&u.pathname.startsWith('/company/'))return'linkedin';return null;
}
export function researchLeadBasis(lead:Partial<Lead>){return Object.fromEntries(['id','listId','name','companyName','site','cnpj','email','phone','address','city','state','summary','instagram','facebook','linkedin'].map(k=>[k,(lead as Record<string,unknown>)[k]??null]));}
export function extractCompanyFacts(company:Pick<Lead,'id'|'name'>&Partial<Lead>,pages:ResearchPage[]):ResearchFact[]{
 const facts:ResearchFact[]=[],seen=new Set<string>();
 for(const page of pages.slice(0,10)){
  if(!researchUrl(page.url)||!page.text.trim())continue;
  const attribution=matchCompanySource({companyDomain:company.site??'',candidateDomain:page.url,corroborated:page.corroborated===true})==='matched'?'company':'uncertain';
  const put=(field:ResearchField,value:string,quote=page.text.slice(0,1200))=>{
   if(!value||!quote||!page.text.includes(quote))return;const key=field+'|'+value+'|'+attribution;if(seen.has(key))return;seen.add(key);
   facts.push({id:'',leadId:company.id,field,value,evidence:[{id:page.id,url:page.url,fetchedAt:page.fetchedAt,quote,hash:page.hash,sourceVersion:researchContractVersion}],attribution});
  };
  const snippet=(needle:string)=>{const at=page.text.toLowerCase().indexOf(needle.toLowerCase());return page.text.slice(Math.max(0,at-120),Math.max(0,at-120)+1200);};
  const contacts=extractContacts([page]);for(const email of contacts.emails.slice(0,3))put('email',email,snippet(email));
  for(const raw of contacts.phones.slice(0,3)){const digits=raw.replace(/\D/g,'');if(!/^(?:55)?\d{10,11}$/.test(digits))continue;const phone='+'+(digits.startsWith('55')&&digits.length>=12?digits:'55'+digits);const literal=(page.text.match(/(?:\+55\s*)?\(?\d{2}\)?[\s.-]*\d{4,5}[\s.-]*\d{4}/g)??[]).find(v=>v.replace(/\D/g,'').endsWith(digits.replace(/^55(?=\d{10,11}$)/,'')));if(literal)put('phone',phone,snippet(literal));}
  if(attribution==='company'&&page.sourceKind!=='social'&&page.sourceKind!=='registry'){put('site',researchUrl(page.url)!.origin);if(!facts.some(f=>f.field==='summary'&&f.attribution==='company'))put('summary',page.text.slice(0,1200));}
  for(const value of page.socialLinks??[]){const field=socialField(value);if(field&&page.text.includes(value))put(field,researchUrl(value)!.toString(),snippet(value));}
 }
 return facts.slice(0,50);
}
