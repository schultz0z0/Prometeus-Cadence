import type {Candidate,CandidatePage} from '../../domain/prospecting.ts';
import {normalizeSite} from './normalize.ts';
// Search engines, social networks, directories and aggregators are never a company's own site.
const platformDomains=['google.com','google.com.br','googleusercontent.com','gstatic.com','goo.gl','google.site','instagram.com','facebook.com','linkedin.com','youtube.com','whatsapp.com','wa.me','linktr.ee','cnpj.biz','casadosdados.com.br','econodata.com.br','apontador.com.br','guiamais.com.br','loqal.com.br','doctoralia.com.br','telelistas.net','solutudo.com.br','reclameaqui.com.br','wikipedia.org','tripadvisor.com.br','yelp.com','kekanto.com.br','jusbrasil.com.br','cnpja.com'];
export function institutionalSite(value:unknown){
  const site=normalizeSite(value);
  if(!site)return undefined;
  const host=new URL(site).hostname;
  return platformDomains.some(domain=>host===domain||host.endsWith('.'+domain))?undefined:site;
}
const listing=/\b(melhores|top\s*\d+|\d+\s+melhores|lista\s+de|ranking|guia\s+de|empresas\s+de|onde\s+encontrar|encontre)\b/i;
const letters=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const phoneLike=/^\(?\d{2}\)?\s*\d{4,5}[\s.-]?\d{4}$/;
// A web result becomes a lead only when it is a company's own site; its name is the title part that matches the domain.
export function webCompanyPage(page:CandidatePage):CandidatePage{
  const candidates:Candidate[]=[],rejected=[...page.rejected];
  for(const candidate of page.candidates){
    const site=institutionalSite(candidate.site);
    if(!site||listing.test(candidate.name)){rejected.push({reason:'NOT_A_COMPANY_SITE'});continue;}
    const parts=candidate.name.split(/\s+[|–—-]\s+/).map(part=>part.trim()).filter(Boolean),phone=parts.find(part=>phoneLike.test(part));
    const names=parts.filter(part=>part!==phone),host=letters(new URL(site).hostname.replace(/^www\./,'').split('.')[0]);
    const name=names.find(part=>{const words=letters(part);return words.length>2&&(host.includes(words)||words.includes(host));})??names[0]??candidate.name;
    candidates.push({...candidate,name,site,...(!candidate.phone&&phone?{phone:phone.replace(/\D/g,'')}:{})});
  }
  return {...page,candidates,rejected};
}
