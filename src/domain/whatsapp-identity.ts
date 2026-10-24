export function whatsappIdentityScope(provider:string,connectionId:string,remoteAccount:string|null):string{return provider==='openwa'?'openwa:'+connectionId:provider+':'+remoteAccount;}
export function whatsappPhoneExternalId(scope:string,phone:string):string{return phone.slice(1)+(scope.startsWith('openwa:')?'@c.us':'');}
