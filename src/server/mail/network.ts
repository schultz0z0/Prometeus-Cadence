import {isIP} from 'node:net';
import type {ConnectionOptions} from 'node:tls';
import {isPublicAddress,resolvePublicDns,type ResolveDns} from '../prospecting/extraction/public-url.ts';
export interface NetworkDeps {resolve:ResolveDns}
export interface MailEndpoint {address:string;family:4|6;servername:string;port:number}
export async function resolveMailEndpoint(host:string,port:number,protocol:'smtp'|'imap',deps:NetworkDeps={resolve:resolvePublicDns}):Promise<MailEndpoint> {
 if(!/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?$/.test(host)||!host.includes('.')||host.endsWith('.local')||isIP(host)||host.split('.').some(l=>!l||l.length>63||l.startsWith('-')||l.endsWith('-')))throw Error('MAIL_PUBLIC_HOST_REQUIRED');
 if(protocol==='smtp'?![465,587].includes(port):port!==993)throw Error('MAIL_TLS_PORT_REQUIRED');
 const addresses=await Promise.race([deps.resolve(host),new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(Error('MAIL_DNS_TIMEOUT')),10000);timer.unref();})]);
 if(!addresses.length||addresses.some(a=>!isPublicAddress(a.address)||isIP(a.address)!==a.family))throw Error('MAIL_PUBLIC_ADDRESS_REQUIRED');
 return {...addresses[0],servername:host.toLowerCase(),port};
}
export function pinnedMailSocketOptions(endpoint:MailEndpoint):ConnectionOptions&{host:string;port:number} {
 return {host:endpoint.address,port:endpoint.port,servername:endpoint.servername,rejectUnauthorized:true,minVersion:'TLSv1.2'};
}
