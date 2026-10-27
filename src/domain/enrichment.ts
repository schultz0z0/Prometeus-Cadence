import {z} from 'zod';
import type {Evidence,Decision} from './prospecting.ts';
export interface Decisor{name:string;role:string;email?:string;phone?:string;linkedin?:string;evidenceId:string;sourceUrl:string;quote:string;whatsapp:'unverified'|'published_link'}
export interface EnrichmentOptions{maxCredits:number;destinationName:string}
export interface ContactEnrichment{people:Decisor[];jobId:string;resolvedAt:string;delivered:boolean}
export interface EnrichmentResult{cnpj:string;people:Decisor[];cacheId:string;cached:boolean;charged:boolean;resolvedAt:string;assessment?:Decision}
export function enrichmentBatch(leads:readonly {id:string;cnpj?:string;listId:string;qualification:string}[],listId:string,page:number){
 const unique=new Map<string,string>();for(const lead of [...leads].sort((a,b)=>a.id.localeCompare(b.id))){if(lead.listId!==listId||lead.qualification!=='qualified'||!lead.cnpj)continue;const cnpj=lead.cnpj.replace(/[^a-z0-9]/gi,'').toUpperCase();if(!unique.has(cnpj))unique.set(cnpj,lead.id);}
 const ids=[...unique.values()];return{total:ids.length,leadIds:ids.slice(Math.max(0,page)*100,Math.max(0,page)*100+100)};
}
const personSchema=z.strictObject({name:z.string().trim().min(5).max(200),role:z.string().trim().min(2).max(150),email:z.string().trim().max(254).optional(),phone:z.string().trim().max(40).optional(),linkedin:z.string().url().max(500).optional(),evidenceId:z.string().min(1).max(120),quote:z.string().min(10).max(1200)});
const schema=z.strictObject({people:z.array(personSchema).max(10)});
const fold=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
export function normalizePersonalPhone(v:string|undefined){if(!v)return undefined;let n=v.replace(/\D/g,'');if(n.length===10||n.length===11)n='55'+n;return /^55\d{10,11}$/.test(n)?'+'+n:undefined;}
export function personalContactKey(p:{name:string;email?:string;phone?:string}){return fold(p.name)+'|'+(p.email?.toLowerCase()??'')+'|'+(normalizePersonalPhone(p.phone)??'');}
export function validateDecisorEvidence(raw:unknown,evidence:Evidence[],company:{name:string;companyName?:string;email?:string;phone?:string},knownNames:string[]=[],corporatePhones:string[]=[]):Decisor[]{
 const parsed=schema.parse(raw),seen=new Set<string>(),out:Decisor[]=[];
 for(const p of parsed.people){
  const e=evidence.find(e=>e.id===p.evidenceId);if(!e||!e.text.includes(p.quote))continue;
  let source:URL;try{source=new URL(e.url);if(!['https:','http:'].includes(source.protocol)||source.username||source.password)continue;}catch{continue;}
  const quote=fold(p.quote),name=fold(p.name),role=fold(p.role);
  if(name.split(' ').length<2||/^(equipe|time|contato|comercial|atendimento)\b/.test(name)||!quote.includes(name)||!quote.includes(role)||!/(socio|fundador|diretor|presidente|gerente|propriet|administr|\bceo\b|\bowner\b|\bfounder\b|\bhead\b|\bpartner\b)/.test(role))continue;
  if(!knownNames.some(n=>fold(n)===name)&&![company.name,company.companyName].some(n=>n&&fold(n).length>=4&&quote.includes(fold(n))))continue;
  const email=p.email?.toLowerCase(),phone=normalizePersonalPhone(p.phone);
  if(p.email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email!)||!quote.includes(email!)||email===company.email?.toLowerCase()||/^(contato|comercial|atendimento|info|suporte|sac|vendas|financeiro|hello|sales|contact|office)([.+_-]|@)/.test(email!)))continue;
  const numbers=p.quote.match(/(?:\+?55\s*)?\(?\d{2}\)?[\s.-]*\d{4,5}[\s.-]*\d{4}/g)??[];
  if(p.phone&&(!phone||[company.phone,...corporatePhones].some(n=>normalizePersonalPhone(n)===phone)||!numbers.some(n=>normalizePersonalPhone(n)===phone)))continue;
  if(!email&&!phone)continue;
  const publishedPhone=numbers.find(n=>normalizePersonalPhone(n)===phone);
  const contactAt=email?quote.indexOf(email):publishedPhone?quote.indexOf(fold(publishedPhone)):-1;
  if(contactAt>=0&&Math.abs(contactAt-quote.indexOf(name))>350)continue;
  const attribution=quote.slice(Math.max(0,contactAt-220),contactAt);
  if(!attribution.includes(name)||!/(contato pessoal|contato direto|personal contact|direct contact|e-?mail (pessoal )?de|telefone (pessoal )?de|celular (pessoal )?de)/.test(attribution))continue;
  if(p.phone&&publishedPhone){const beforePhone=quote.slice(Math.max(0,quote.indexOf(fold(publishedPhone))-70),quote.indexOf(fold(publishedPhone)));if(/(?:telefone|phone|contato|celular)\s*(?:geral|corporativo|da empresa|da equipe)|(?:central|recepcao|atendimento)\s*[:\-]/.test(beforePhone))continue;}
  let linkedin:string|undefined;if(p.linkedin){try{const u=new URL(p.linkedin);if(u.protocol!=='https:'||!/(^|\.)linkedin\.com$/.test(u.hostname)||!u.pathname.startsWith('/in/')||!e.text.includes(p.linkedin))continue;linkedin=u.toString();}catch{continue;}}
  const key=personalContactKey(p);if(seen.has(key))continue;seen.add(key);
  const publishedLink=!!phone&&new RegExp('(?:wa\\.me/|api\\.whatsapp\\.com/send\\?phone=)'+phone.slice(1)+'(?:\\D|$)').test(p.quote);
  out.push({name:p.name,role:p.role,...(email?{email}:{}),...(phone?{phone}:{}),...(linkedin?{linkedin}:{}),evidenceId:e.id,sourceUrl:source.toString(),quote:p.quote,whatsapp:publishedLink?'published_link':'unverified'});
 }return out;
}
