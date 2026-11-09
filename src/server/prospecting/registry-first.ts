import {brazilianStates,type JourneyInput} from '../../domain/prospecting-journey.ts';
import type {Candidate,Evidence} from '../../domain/prospecting.ts';
import {extractCnpjs} from './extraction/contacts.ts';
import {phoneIdentity,verifySiteContent} from './qualification.ts';

const words=(value='')=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const states=new Map(Object.entries(brazilianStates).map(([uf,name])=>[words(name),uf.toLowerCase()]));
const state=(value?:string)=>states.get(words(value))??words(value);
const name=(value?:string)=>words(value).replace(/^re /,'').replace(/(?: (?:ltda|eireli|me|epp))+$/,'');
function address(candidate:Candidate){
 const raw=typeof candidate.facts?.street==='string'?candidate.facts.street:candidate.address;
 if(!raw)return '';
 // A Maps formatted address may append neighborhood, city, UF and CEP.
 const streetNumber=raw.match(/^(.+?)[, ]+([0-9]+[a-z]?)(?=\s*(?:[,–-]|$))/i);
 if(!streetNumber)return '';
 return words(`${streetNumber[1]} ${streetNumber[2]}`).replace(/^r /,'rua ').replace(/^av /,'avenida ').replace(/\bsrg\b/g,'sargento');
}

export function isRegistryCandidate(candidate:Candidate,scope:NonNullable<JourneyInput['registry']>){
 return candidate.facts?.registrationStatus==='ATIVA'&&words(candidate.city)===words(scope.city)&&state(candidate.state)===state(scope.uf)&&
  candidate.cnae?.replace(/\D/g,'')===scope.cnae&&!!candidate.cnpj&&extractCnpjs([{id:'registry',url:'',hash:'',text:candidate.cnpj,fetchedAt:'',truncated:false}]).includes(candidate.cnpj);
}

export function registryMapsMatch(registry:Candidate,maps:Candidate){
 if(maps.facts?.permanentlyClosed===true||!/^\d{10,11}$/.test(phoneIdentity(maps.phone??'')))return false;
 if(!maps.city||!maps.state||words(maps.city)!==words(registry.city)||state(maps.state)!==state(registry.state))return false;
 if(!name(maps.name)||![registry.name,registry.companyName].some(value=>value&&name(value)===name(maps.name)))return false;
 const cadastral=address(registry),observed=address(maps);
 if(cadastral&&observed)return cadastral===observed;
 return phoneIdentity(registry.phone??'')===phoneIdentity(maps.phone!);
}

export function registrySiteMatches(registry:Candidate,maps:Candidate,pages:Evidence[]){
 const cnpjs=extractCnpjs(pages);
 if(cnpjs.some(cnpj=>cnpj!==registry.cnpj))return false;
 const confirmedByAddress=address(registry)&&address(registry)===address(maps);
 if(!confirmedByAddress&&!cnpjs.includes(registry.cnpj!))return false;
 return verifySiteContent({...maps,companyName:registry.companyName,cnpj:registry.cnpj,id:'registry',listId:'registry',qualification:'pending',createdAt:''},pages);
}
