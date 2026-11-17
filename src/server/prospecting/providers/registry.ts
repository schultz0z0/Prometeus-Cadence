import type {Candidate} from '../../../domain/prospecting.ts';
import type {Fetch} from './types.ts';
import {ProviderError,providerJson} from './transport.ts';
import {normalizeCnpj,normalizeDecisionMakers} from '../normalize.ts';
import {hashValue} from '../review.ts';
// 17/11/2026: one-CNPJ lookups — CNPJá (paid, own base) first, the public OpenCNPJ API when CNPJá fails or does not find it.
export type RegistryProvider='cnpja'|'opencnpj';
export type RegistryLookup=(cnpj:string,options:{partners:boolean;signal:AbortSignal})=>Promise<{provider:RegistryProvider;candidate:Candidate}>;
type Row=Record<string,any>;
const str=(v:unknown,max=500)=>typeof v==='string'&&v.trim()?v.trim().slice(0,max):typeof v==='number'&&Number.isFinite(v)?String(v):undefined;
const STATUS=['ATIVA','BAIXADA','INAPTA','SUSPENSA','NULA'];
/** Area + local number; an old 8-digit mobile (6–9) gets the leading 9. */
export function registryPhone(area:string,number:string):string|undefined{
 const a=String(area??'').replace(/\D/g,''),n=String(number??'').replace(/\D/g,'');
 if(a.length!==2||!n)return undefined;
 const local=n.length===8&&/^[6-9]/.test(n)?'9'+n:n;
 return local.length===8||local.length===9?a+local:undefined;
}
function build(cnpj:string,provider:RegistryProvider,f:{name?:string;companyName?:string;city?:string;state?:string;phone?:string;email?:string;cnae?:string;openedAt?:string;size?:string;legalNature?:string;capital?:string;status?:string;street?:string;decisionMakers?:{name:string;role:string}[]}):Candidate{
 const name=f.name||f.companyName;if(!name)throw new ProviderError('INVALID_RECORD');
 const email=f.email?.toLowerCase(),status=f.status?.toUpperCase();
 const c:Candidate={name,source:'CNPJ',sourceRef:cnpj,cnpj};
 const fields={companyName:f.companyName,city:f.city,state:f.state,phone:f.phone,email:email&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:undefined,cnae:f.cnae,openedAt:f.openedAt,size:f.size,legalNature:f.legalNature,capital:f.capital};
 for(const[k,v]of Object.entries(fields))if(v)(c as unknown as Record<string,unknown>)[k]=v;
 c.facts={registrationStatus:status&&STATUS.includes(status)?status:undefined,...(f.street?{street:f.street.slice(0,500)}:{}),...(f.decisionMakers?{decisionMakers:f.decisionMakers}:{})};
 const url=provider==='cnpja'?`https://cnpja.com/office/${cnpj}`:`https://opencnpj.org/${cnpj}`;
 const text=JSON.stringify({source:provider,sourceRef:cnpj,name:c.name,companyName:c.companyName,cnpj,city:c.city,state:c.state,phone:c.phone,email:c.email,cnae:c.cnae,openedAt:c.openedAt,...c.facts}).slice(0,6000);
 c.evidence=[{id:hashValue({registry:provider,cnpj}),url,text,hash:hashValue(text),fetchedAt:new Date().toISOString(),truncated:false}];
 return c;
}
function fromCnpja(cnpj:string,r:Row,partners:boolean):Candidate{
 if(normalizeCnpj(r?.taxId)!==cnpj)throw new ProviderError('INVALID_RECORD');
 const co=r.company??{},a=r.address??{},phone=Array.isArray(r.phones)?r.phones.map((p:Row)=>registryPhone(p?.area,p?.number)).find(Boolean):undefined;
 const id=r.mainActivity?.id;
 return build(cnpj,'cnpja',{name:str(r.alias,300),companyName:str(co.name,300),city:str(a.city,200),state:str(a.state,100),phone,
  email:Array.isArray(r.emails)?str(r.emails.find((e:Row)=>str(e?.address))?.address,300):undefined,
  cnae:typeof id==='number'||typeof id==='string'?String(id).replace(/\D/g,'').padStart(7,'0'):undefined,openedAt:str(r.founded,100),
  size:str(co.size?.text,100),legalNature:str(co.nature?.text,300),capital:str(co.equity,100),status:str(r.status?.text,50),
  street:[str(a.street),str(a.number)].every(Boolean)?`${str(a.street)}, ${str(a.number)}`:undefined,
  decisionMakers:partners?normalizeDecisionMakers(Array.isArray(co.members)?co.members.map((m:Row)=>({name:m?.person?.name,role:m?.role?.text})):[]):undefined});
}
function fromOpen(cnpj:string,r:Row,partners:boolean):Candidate{
 if(normalizeCnpj(r?.cnpj)!==cnpj)throw new ProviderError('INVALID_RECORD');
 const phone=Array.isArray(r.telefones)?r.telefones.filter((p:Row)=>!p?.is_fax).map((p:Row)=>registryPhone(p?.ddd,p?.numero)).find(Boolean):undefined;
 const street=[str(r.tipo_logradouro),str(r.logradouro)].filter(Boolean).join(' '),number=str(r.numero);
 return build(cnpj,'opencnpj',{name:str(r.nome_fantasia,300),companyName:str(r.razao_social,300),city:str(r.municipio,200),state:str(r.uf,100),phone,email:str(r.email,300),
  cnae:str(r.cnae_principal,20),openedAt:str(r.data_inicio_atividade,100),size:str(r.porte_empresa,100),legalNature:str(r.natureza_juridica,300),capital:str(r.capital_social,100),
  status:str(r.situacao_cadastral,50),street:street&&number?`${street}, ${number}`:undefined,decisionMakers:partners?normalizeDecisionMakers(r.QSA):undefined});
}
export function createRegistryLookup(deps:{fetcher?:Fetch;apiKey?:string|null}={}):RegistryLookup{
 const fetcher=deps.fetcher??globalThis.fetch,apiKey=deps.apiKey===undefined?process.env.CNPJA_API_KEY?.trim()||null:deps.apiKey;
 return async(raw,{partners,signal})=>{
  const cnpj=normalizeCnpj(raw);if(!cnpj)throw new ProviderError('CNPJ_NOT_FOUND');
  if(apiKey){
   // Any CNPJá failure (limit, credits, key, outage, not found) falls back; the key never enters errors.
   try{return {provider:'cnpja',candidate:fromCnpja(cnpj,await providerJson(fetcher,`https://api.cnpja.com/office/${cnpj}?strategy=CACHE_IF_FRESH&maxAge=45`,{headers:{Authorization:apiKey}},signal) as Row,partners)};}
   catch{if(signal.aborted)throw new ProviderError('CNPJ_SOURCE_ERROR');}
  }
  try{return {provider:'opencnpj',candidate:fromOpen(cnpj,await providerJson(fetcher,`https://api.opencnpj.org/${cnpj}`,{},signal) as Row,partners)};}
  catch(e){throw new ProviderError(e instanceof ProviderError&&e.code==='HTTP_404'?'CNPJ_NOT_FOUND':'CNPJ_SOURCE_ERROR');}
 };
}
export const lookupRegistry:RegistryLookup=(cnpj,options)=>createRegistryLookup()(cnpj,options);
