export function whatsappIdentityScope(provider:string,connectionId:string,remoteAccount:string|null):string{return provider==='openwa'?'openwa:'+connectionId:provider+':'+remoteAccount;}
export function whatsappPhoneExternalId(scope:string,phone:string):string{return phone.slice(1)+(scope.startsWith('openwa:')?'@c.us':'');}
// A lead phone in E.164; a Brazilian number saved without +55 (DDD + 8/9 digits) is read as Brazilian.
export function leadWhatsappPhone(value:string|null|undefined):string|null{
 const raw=value?.trim();if(!raw)return null;const digits=raw.replace(/\D/g,'');
 const e164=raw.startsWith('+')?'+'+digits:/^\d{10,11}$/.test(digits)?'+55'+digits:/^55\d{10,11}$/.test(digits)?'+'+digits:null;
 return e164&&/^\+[1-9]\d{6,14}$/.test(e164)?e164:null;
}
