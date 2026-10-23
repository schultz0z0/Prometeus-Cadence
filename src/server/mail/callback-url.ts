import {AppError} from '../errors.ts';
export function gmailCallbackUrl(request:Pick<Request,'url'|'headers'>,registeredRedirectUri:string):URL{
 const actual=new URL(request.url),expected=new URL(registeredRedirectUri),host=request.headers.get('host');
 if(actual.username||actual.password||actual.hash||actual.pathname!==expected.pathname||(host!==null&&host!==expected.host))throw new AppError(422,'Retorno da autorização inválido.');
 if(actual.origin===expected.origin)return actual;
 // NextURL canonicalizes loopback IPs to "localhost". Restore only the exact
 // registered authority corroborated by Host; forwarding headers are ignored.
 if(actual.hostname==='localhost'&&['127.0.0.1','[::1]'].includes(expected.hostname)&&actual.protocol===expected.protocol&&actual.port===expected.port&&host===expected.host){actual.hostname=expected.hostname;return actual;}
 throw new AppError(422,'O endereço de retorno não corresponde à configuração Google.');
}
