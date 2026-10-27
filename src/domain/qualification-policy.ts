export interface QualificationOptions{onlyWithSite?:boolean;onlyMissingEmail?:boolean;skipProcessed?:boolean;skipWithoutSite?:boolean;disqualifyNoEmail?:boolean;language?:'pt-BR'|'en'|'es'}
export function qualificationOptionsFromFilters(filters:Record<string,string>):QualificationOptions{
 const options:QualificationOptions={};
 for(const key of ['onlyWithSite','onlyMissingEmail','skipProcessed','skipWithoutSite','disqualifyNoEmail'] as const)if(filters[key]!==undefined){if(!['true','false'].includes(filters[key]))throw Error('INVALID_QUALIFICATION_OPTION');options[key]=filters[key]==='true';}
 if(filters.language!==undefined){if(!['pt-BR','en','es'].includes(filters.language))throw Error('INVALID_QUALIFICATION_LANGUAGE');options.language=filters.language as QualificationOptions['language'];}return options;
}
export interface EmailAssessment{address:string;format:'valid'|'invalid';domain:'found'|'not_found'|'unknown';mailbox:'unverified';checkedAt:string}
export function qualificationFingerprint(lead:object){const values=lead as Record<string,unknown>;return JSON.stringify(['name','companyName','cnpj','site','email','phone','city','state'].map(k=>values[k]??null));}
export function qualificationSkipReason(lead:{email?:string;site?:string},options:QualificationOptions={},processed=false){
 if((options.onlyWithSite||options.skipWithoutSite)&&!lead.site?.trim())return 'NO_SITE';
 if(options.onlyMissingEmail&&lead.email?.trim())return 'ALREADY_HAS_EMAIL';
 if(options.skipProcessed&&processed)return 'ALREADY_PROCESSED';return null;
}
export function assessEmail(address:string,result:{format:boolean;dns:boolean|null;mailbox:string},checkedAt:string):EmailAssessment{
 return {address,format:result.format?'valid':'invalid',domain:result.dns===true?'found':result.dns===false?'not_found':'unknown',mailbox:'unverified',checkedAt};
}
