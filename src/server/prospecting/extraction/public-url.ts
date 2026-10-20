import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import {isIP} from 'node:net';
export type ResolveDns=(hostname:string)=>Promise<{address:string;family:4|6}[]>;
export const resolvePublicDns:ResolveDns=async hostname=>(await dns.lookup(hostname,{all:true,verbatim:true})).map(r=>({address:r.address,family:r.family as 4|6}));
export function isPublicAddress(address:string){try{const parsed=ipaddr.process(address);return parsed.range()==='unicast';}catch{return false;}}
export interface ApprovedUrl{url:URL;address:string;family:4|6}
export async function approvePublicUrl(value:string,resolve:ResolveDns=resolvePublicDns):Promise<ApprovedUrl>{
  const url=new URL(value),host=url.hostname.replace(/^\[|\]$/g,'');
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||(url.port&&!['80','443'].includes(url.port))||!host||host.endsWith('.local')||host==='localhost')throw Error('PUBLIC_URL_REQUIRED');
  const addresses=isIP(host)?[{address:host,family:isIP(host) as 4|6}]:await resolve(host);
  if(!addresses.length||addresses.some(a=>!isPublicAddress(a.address)))throw Error('PUBLIC_ADDRESS_REQUIRED');
  return{url,address:addresses[0].address,family:addresses[0].family};
}
