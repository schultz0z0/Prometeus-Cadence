import {z} from 'zod';
import type {Evidence,Decision} from './prospecting.ts';
export interface Decisor{name:string;role:string;email?:string;phone?:string;linkedin?:string;evidenceId:string;sourceUrl:string;quote:string;whatsapp:'unverified'|'published_link';contactBasis?:'provider'}
export interface EnrichmentOptions{maxCredits:number;destinationName:string}
export interface ContactEnrichment{people:Decisor[];jobId:string;resolvedAt:string;delivered:boolean}
export interface EnrichmentResult{cnpj:string;people:Decisor[];cacheId:string;cached:boolean;charged:boolean;resolvedAt:string;assessment?:Decision}
// Same format rule as the server (normalizeCnpj): one malformed CNPJ must not sink the whole batch.
export const validCnpj=(value?:string)=>{const text=value?.replace(/[.\/\s-]/g,'').toUpperCase();return text&&/^[A-Z0-9]{12}[0-9]{2}$/.test(text)?text:undefined;};
export function enrichmentBatch(leads:readonly {id:string;cnpj?:string;listId:string}[],listId:string,page:number){
 const unique=new Map<string,string>();for(const lead of [...leads].sort((a,b)=>a.id.localeCompare(b.id))){if(lead.listId!==listId)continue;const cnpj=validCnpj(lead.cnpj);if(!cnpj)continue;if(!unique.has(cnpj))unique.set(cnpj,lead.id);}
 const ids=[...unique.values()];return{total:ids.length,leadIds:ids.slice(Math.max(0,page)*100,Math.max(0,page)*100+100)};
}
// Decision makers named by the registry: the QSA, or the holder of a sole proprietorship, whose legal name is "<CNPJ base> <owner name>".
export function registryDecisionMakers(registry:{companyName?:string;facts?:Record<string,unknown>}):{name:string;role:string}[]{
 const qsa=Array.isArray(registry.facts?.decisionMakers)?(registry.facts!.decisionMakers as {name?:unknown;role?:unknown}[]).filter((p):p is {name:string;role:string}=>typeof p?.name==='string'&&typeof p?.role==='string'):[];
 if(qsa.length)return [...new Map(qsa.map(p=>[p.name.toLowerCase(),{name:p.name,role:p.role}])).values()].slice(0,10);
 const owner=registry.companyName?.match(/^\d{2}\.\d{3}\.\d{3}\s+(\S.{3,})$/)?.[1];
 return owner?[{name:owner.trim(),role:'Titular (MEI)'}]:[];
}
const words=(v:string):string[]=>v.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().match(/[a-z0-9]+/g)??[];
const legal=new Set(['ltda','eireli','epp','me','sa','s','a','de','da','do','das','dos','e','servicos','comercio','industria','clinica','odontologica','empresa','grupo']);
// Registry names are full legal names; LinkedIn shows first and last name. The company stays loose: the match below rejects homonyms.
export function linkedinQuery(partnerName:string,companyName:string){
 const cap=(w:string)=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase(),parts=partnerName.trim().split(/\s+/),name=[parts[0],parts.length>1?parts[parts.length-1]:''].filter(Boolean).map(cap).join(' ');
 const company=companyName.split(/\s+/).filter(w=>{const k=words(w)[0];return k&&k.length>2&&!legal.has(k);}).slice(0,2).map(cap).join(' ');
 return `"${name}" ${company} site:linkedin.com/in`.replace(/\s+/g,' ');
}
// A LinkedIn profile belongs to a registry partner only when first and last name match and the current company matches the lead.
export function linkedinDecisors(partners:readonly {name:string;role:string}[],profiles:readonly {url:string;name:string;headline?:string;positions:{title:string;company:string}[];email?:string}[],companyNames:readonly string[]){
 const company=new Set(companyNames.flatMap(words).filter(w=>w.length>3&&!legal.has(w)));
 const out:{partner:{name:string;role:string};profile:(typeof profiles)[number];role:string}[]=[];
 for(const profile of profiles){
  const name=words(profile.name);if(name.length<2)continue;
  const partner=partners.find(p=>{const w=words(p.name);return w[0]===name[0]&&w.includes(name[name.length-1]);});
  const position=profile.positions.find(p=>words(p.company).some(w=>company.has(w)));
  if(!partner||!(position||words(profile.headline??'').some(w=>company.has(w)))||out.some(o=>o.partner===partner))continue;
  out.push({partner,profile,role:position?.title??partner.role});
 }
 return out;
}
export function companyPeopleBatch(leads:readonly {id:string;listId:string}[],listId:string,page:number){const ids=leads.filter(l=>l.listId===listId).map(l=>l.id).sort();return{total:ids.length,leadIds:ids.slice(Math.max(0,page)*100,Math.max(0,page)*100+100)};}
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
  const ownsContact=(at:number)=>{
   const before=quote.slice(Math.max(0,at-220),at);
   const owners=[...before.matchAll(/\b(?:contato pessoal|contato direto|personal contact|direct contact|e-?mail(?: pessoal)?|telefone(?: pessoal)?|celular(?: pessoal)?)\s+(?:de|do|da|of)\s+([^:;]+?)\s*:/g)];
   return owners.at(-1)?.[1].trim()===name;
  };
  if(email&&!ownsContact(quote.indexOf(email))||phone&&publishedPhone&&!ownsContact(quote.indexOf(fold(publishedPhone))))continue;
  if(p.phone&&publishedPhone){const beforePhone=quote.slice(Math.max(0,quote.indexOf(fold(publishedPhone))-70),quote.indexOf(fold(publishedPhone)));if(/(?:telefone|phone|contato|celular)\s*(?:geral|corporativo|da empresa|da equipe)|(?:central|recepcao|atendimento)\s*[:\-]/.test(beforePhone))continue;}
  let linkedin:string|undefined;if(p.linkedin){try{const u=new URL(p.linkedin);if(u.protocol!=='https:'||!/(^|\.)linkedin\.com$/.test(u.hostname)||!u.pathname.startsWith('/in/')||!e.text.includes(p.linkedin))continue;linkedin=u.toString();}catch{continue;}}
  const key=personalContactKey(p);if(seen.has(key))continue;seen.add(key);
  const publishedLink=!!phone&&new RegExp('(?:wa\\.me/|api\\.whatsapp\\.com/send\\?phone=)'+phone.slice(1)+'(?:\\D|$)').test(p.quote);
  out.push({name:p.name,role:p.role,...(email?{email}:{}),...(phone?{phone}:{}),...(linkedin?{linkedin}:{}),evidenceId:e.id,sourceUrl:source.toString(),quote:p.quote,whatsapp:publishedLink?'published_link':'unverified'});
 }return out;
}
