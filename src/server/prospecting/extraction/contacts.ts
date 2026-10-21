import dns from 'node:dns/promises';
import type {Evidence} from '../../../domain/prospecting.ts';
export interface ContactFacts{emails:string[];phones:string[];evidenceIds:string[]}
export function extractCnpjs(evidence:Evidence[]):string[]{
  const matches=evidence.flatMap(e=>e.text.match(/\b[A-Z0-9]{2}\.?[A-Z0-9]{3}\.?[A-Z0-9]{3}\/?[A-Z0-9]{4}-?\d{2}\b/gi)??[]);
  return [...new Set(matches.map(v=>v.replace(/[.\/-]/g,'').toUpperCase()).filter(value=>{
    if(/^(.)\1+$/.test(value))return false;
    const digit=(part:string)=>{const weights=part.length===12?[5,4,3,2,9,8,7,6,5,4,3,2]:[6,5,4,3,2,9,8,7,6,5,4,3,2];const mod=[...part].reduce((sum,c,i)=>sum+(c.charCodeAt(0)-48)*weights[i],0)%11;return String(mod<2?0:11-mod);};
    return digit(value.slice(0,12))===value[12]&&digit(value.slice(0,13))===value[13];
  }))];
}
export function extractContacts(evidence:Evidence[]):ContactFacts{
  const text=evidence.map(e=>e.text).join(' ');
  const emails=[...new Set((text.match(/[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)??[]).map(x=>x.toLowerCase()))].slice(0,20);
  const phones=[...new Set((text.match(/(?<!\d)(?:\+55\d{10,11}|\d{10,11})(?!\d)|(?:\+55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]\d{4}/g)??[]).map(x=>x.replace(/[^+\d]/g,'')))].filter(x=>/^\+?\d{8,15}$/.test(x)).slice(0,20);
  return{emails,phones,evidenceIds:evidence.map(e=>e.id)};
}
export async function checkEmailDns(email:string,resolveMx:typeof dns.resolveMx=dns.resolveMx){
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return{format:false,dns:null,mailbox:'not_verified' as const};
  try{return{format:true,dns:(await resolveMx(email.split('@')[1])).some(r=>!!r.exchange),mailbox:'not_verified' as const};}catch{return{format:true,dns:null,mailbox:'not_verified' as const};}
}
