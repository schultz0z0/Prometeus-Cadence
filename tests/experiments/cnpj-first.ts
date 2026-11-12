import type {Candidate,Evidence} from '../../src/domain/prospecting.ts';
import {extractCnpjs} from '../../src/server/prospecting/extraction/contacts.ts';
import {institutionalSite,phoneIdentity,verifySiteContent} from '../../src/server/prospecting/qualification.ts';

const words=(value='')=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const state=(value?:string)=>words(value)==='sao paulo'?'sp':words(value);
const name=(value?:string)=>words(value).replace(/^re /,'').replace(/ (ltda|me|epp)$/,'');
const streetAddress=(value?:string)=>words(value).replace(/^r /,'rua ').replace(/^rua srg /,'rua sargento ');

export function matchRegistryFirst(maps:Candidate,registry:Candidate[],pages:Evidence[]):Candidate|null{
 const domain=institutionalSite(maps.site),phone=phoneIdentity(maps.phone??''),address=streetAddress(maps.address);
 if(!domain||!/^\d{10,11}$/.test(phone)||maps.facts?.permanentlyClosed===true||!maps.city||!maps.state)return null;
 const sitePages=pages.filter(page=>{
  const url=institutionalSite(page.url);
  return url&&new URL(url).hostname===new URL(domain).hostname;
 });
 if(!sitePages.length)return null;
 const siteCnpjs=extractCnpjs(sitePages);
 const matches=new Map<string,Candidate>();
 for(const candidate of registry){
  const cnpj=candidate.cnpj;
  if(!cnpj||candidate.facts?.registrationStatus!=='ATIVA'||!extractCnpjs([{...sitePages[0],text:cnpj}]).includes(cnpj))continue;
  if(words(candidate.city)!==words(maps.city)||state(candidate.state)!==state(maps.state))continue;
  if(![candidate.name,candidate.companyName].some(value=>value&&name(value)===name(maps.name)))continue;
  const registryAddress=streetAddress(candidate.address);
  if(address&&registryAddress&&address!==registryAddress)continue;
  const sameAddress=address===registryAddress&&/[a-z]/.test(address)&&/\b\d+\b/.test(address);
  const samePhone=phoneIdentity(candidate.phone??'')===phone;
  if(!sameAddress&&!(samePhone&&siteCnpjs.includes(cnpj)))continue;
  matches.set(cnpj,candidate);
 }
 if(matches.size!==1)return null;
 const [[cnpj,candidate]]=matches;
 if(siteCnpjs.some(value=>value!==cnpj))return null;
 const lead={...maps,companyName:candidate.companyName,cnpj:undefined,id:'experiment',listId:'experiment',qualification:'pending' as const,createdAt:''};
 if(!verifySiteContent(lead,sitePages))return null;
 return {...maps,cnpj,companyName:candidate.companyName};
}
