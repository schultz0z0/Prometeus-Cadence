import type {GenerationSource} from './prospecting.ts';
export interface GenerationDraft{source:GenerationSource;term:string;location:string;cnae:string;region:string;cnpj:string}
export function generationFilters(draft:GenerationDraft):Record<string,string>{
 const base={term:draft.term.trim(),...(draft.location.trim()?{location:draft.location.trim()}:{})};
 if(draft.source!=='CNPJ')return base;
 const cnpj=draft.cnpj.replace(/[.\/\s-]/g,'').toUpperCase();
 if(cnpj)return {term:base.term,cnpj};
 return {...base,...(draft.cnae.trim()?{includeCnae:draft.cnae.trim()}:{}),...(draft.region.trim()?{states:draft.region.trim().toUpperCase()}:{})};
}
export function audienceOptionToDraft(option:{source:GenerationSource;filters:Record<string,string>;listName:string;dailyLimit:number}):GenerationDraft&{name:string;limit:number}{
 const allowed:Record<GenerationSource,string[]>={MAPS:['term','location'],WEB:['term','location'],APOLLO:['term','location'],CNPJ:['term','location','includeCnae','states','cnae','state','city','cnpj']};
 if(!allowed[option.source]||!option.filters||Object.entries(option.filters).some(([k,v])=>!allowed[option.source].includes(k)||typeof v!=='string'||v.length>1000)||!option.filters.term?.trim())throw Error('A proposta contém filtros não suportados. Ajuste o público ou informe os campos manualmente.');
 const f=option.filters,draft={source:option.source,name:String(option.listName??'').slice(0,100),term:f.term,location:f.location??f.city??'',cnae:f.includeCnae??f.cnae??'',region:f.states??f.state??'',cnpj:f.cnpj??'',limit:option.dailyLimit};
 if(!Number.isInteger(draft.limit)||draft.limit<1||draft.limit>500||['MAPS','WEB'].includes(draft.source)&&!draft.location.trim()||draft.source==='CNPJ'&&!draft.cnae&&!draft.cnpj)throw Error('A proposta está incompleta para esta fonte. Informe os filtros manualmente.');
 return draft;
}
