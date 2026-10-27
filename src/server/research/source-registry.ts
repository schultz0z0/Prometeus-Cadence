import 'server-only';
import {prospectingConfig} from '../prospecting/config.ts';
import {providerProfile} from '../prospecting/providers/profiles.ts';
import {researchContractVersion} from '../../domain/company-research.ts';
import type {ResearchKind} from '../../domain/company-research.ts';
export function researchSourceRegistry(){
 const config=prospectingConfig();
 const ready=(source:'WEB'|'CNPJ')=>{try{providerProfile(source,config.profiles[source]);return config.ready[source];}catch{return false;}};
 return{version:researchContractVersion,website:{available:config.enabled,contract:'public-company-html-v1'},social:{available:config.enabled,contract:'public-linked-profile-html-v1',authenticated:false},webSearch:{available:ready('WEB'),contract:'approved-apify-web'},registry:{available:ready('CNPJ'),contract:'approved-apify-cnpj'}};
}
export function researchSourceWarnings(kinds:ResearchKind[]){const r=researchSourceRegistry();return[
 ...(kinds.includes('social')?['Redes sociais: páginas públicas ligadas ao site. Perfis privados ou bloqueados não são acessados; a cobertura pode ser parcial.']:[]),
 ...(kinds.includes('registry')&&!r.registry.available?['Consulta cadastral indisponível; a investigação continuará com as demais fontes habilitadas.']:[]),
 ...(!r.webSearch.available?['Busca de sites indisponível; contatos sem um site informado poderão ficar sem resultado.']:[]),
 ];}
