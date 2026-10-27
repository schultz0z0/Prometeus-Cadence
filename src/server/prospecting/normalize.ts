import type {Candidate,GenerationSource} from '../../domain/prospecting.ts';
const string=(v:unknown,max=1000)=>typeof v==='string'?v.trim().slice(0,max):undefined;
export function normalizeCnpj(value:unknown){
  const text=string(value)?.replace(/[.\/\s-]/g,'').toUpperCase();
  return text&&/^[A-Z0-9]{12}[0-9]{2}$/.test(text)?text:undefined;
}
export function normalizeSite(value:unknown){
  const text=string(value);if(!text)return undefined;
  try{const u=new URL(text.includes('://')?text:'https://'+text);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return undefined;return `${u.protocol}//${u.hostname.toLowerCase().replace(/^www\./,'')}${u.port?':'+u.port:''}/`;}catch{return undefined;}
}
export function normalizeCandidate(raw:unknown,profile:GenerationSource):Candidate{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('INVALID_CANDIDATE');
  const r=raw as Record<string,unknown>,name=string(r.name??r.title??(profile==='CNPJ'?r.nome_fantasia:undefined)??r.razao_social,300)||string(r.razao_social,300),sourceRef=string(r.sourceRef??r.placeId??r.id??r.cnpj,500);
  if(!name||!sourceRef)throw Error('MISSING_IDENTITY');
  const registryPhone=profile==='CNPJ'?(Array.isArray(r.telefones)?r.telefones.find(p=>typeof p==='string'&&p.trim()):undefined)??r.ddd_telefone_1:undefined;
  const email=string(r.email)?.toLowerCase(),phone=string(r.phone??r.phoneNumber??registryPhone)?.replace(/[^0-9+]/g,'');
  const candidate:Candidate={name,sourceRef,source:profile};
  const fields={companyName:string(r.companyName??(profile==='CNPJ'?r.razao_social:undefined),300),email:email&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:undefined,phone:phone&&/^\+?\d{7,15}$/.test(phone)?phone:undefined,site:normalizeSite(r.site??r.website??r.primary_domain),city:string(r.city??(profile==='CNPJ'?r.municipio:undefined),200),state:string(r.state??(profile==='CNPJ'?r.uf:undefined),100),cnpj:normalizeCnpj(r.cnpj)};
  for(const [k,v]of Object.entries(fields))if(v)(candidate as unknown as Record<string,unknown>)[k]=v;
  if(profile==='CNPJ'){
    const scalar=(v:unknown,max=500)=>typeof v==='number'&&Number.isFinite(v)?String(v):string(v,max);
    const extra={capital:scalar(r.capital??r.capital_social,100),size:scalar(r.size??r.porte,100),legalNature:scalar(r.legalNature??r.natureza_juridica,300),cnae:scalar(r.cnae??r.cnae_fiscal,200),openedAt:scalar(r.openedAt??r.data_inicio_atividade,100),address:scalar(r.address??r.endereco_completo,500)};
    for(const[k,v]of Object.entries(extra))if(v)(candidate as unknown as Record<string,unknown>)[k]=v;
  }
  // Arbitrary provider fields and instructions never become editable lead fields.
  return candidate;
}
export function normalizeDecisionMakers(raw:unknown):{name:string;role:string}[]{
 if(!Array.isArray(raw))return[];const out:{name:string;role:string}[]=[];
 for(const row of raw.slice(0,50)){if(!row||typeof row!=='object')continue;const name=string(row.nome_socio??row.nome_socio_razao_social??row.name,200),role=string(row.qualificacao_socio??row.role,150);if(name&&role)out.push({name,role});}return out;
}
export function strongIdentities(candidate:Candidate){
  return [...(candidate.cnpj?['cnpj:'+candidate.cnpj]:[]),`source:${candidate.source}:${candidate.sourceRef}`];
}
