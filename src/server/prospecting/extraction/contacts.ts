import dns from 'node:dns/promises';
import type {Evidence} from '../../../domain/prospecting.ts';
export interface ContactFacts{emails:string[];phones:string[];evidenceIds:string[]}
export function extractContacts(evidence:Evidence[]):ContactFacts{
  const text=evidence.map(e=>e.text).join(' ');
  const emails=[...new Set((text.match(/[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)??[]).map(x=>x.toLowerCase()))].slice(0,20);
  const phones=[...new Set((text.match(/(?:\+55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]\d{4}/g)??[]).map(x=>x.replace(/[^+\d]/g,'')))].filter(x=>/^\+?\d{8,15}$/.test(x)).slice(0,20);
  return{emails,phones,evidenceIds:evidence.map(e=>e.id)};
}
export async function checkEmailDns(email:string,resolveMx:typeof dns.resolveMx=dns.resolveMx){
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return{format:false,dns:null,mailbox:'not_verified' as const};
  try{return{format:true,dns:(await resolveMx(email.split('@')[1])).some(r=>!!r.exchange),mailbox:'not_verified' as const};}catch{return{format:true,dns:null,mailbox:'not_verified' as const};}
}
