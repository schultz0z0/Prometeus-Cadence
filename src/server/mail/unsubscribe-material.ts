import 'server-only';
import {randomBytes,createHash} from 'node:crypto';
import type {Principal} from '../../domain/workspace.ts';
import type {PublicationInputV2} from '../../domain/cadence-runtime.ts';
import {encryptCredential,decryptCredential} from '../channels/crypto.ts';
import {AppError} from '../errors.ts';
const context=(p:Principal,input:PublicationInputV2)=>({workspaceId:p.workspaceId,connectionId:'publication-review:'+p.userId+':'+input.cadenceId,provider:'gmail' as const,revision:input.expectedRevision+1});
export function createPublicationMailMaterial(p:Principal,input:PublicationInputV2){const tokens=Object.fromEntries(input.leadIds.map(id=>[id,randomBytes(32).toString('base64url')]));return Buffer.from(JSON.stringify(encryptCredential(tokens,context(p,input)))).toString('base64url');}
export function readPublicationMailMaterial(p:Principal,input:PublicationInputV2,material:string):Record<string,string>{
 try{if(material.length>262144)throw Error();const tokens=decryptCredential(JSON.parse(Buffer.from(material,'base64url').toString()),context(p,input));if(input.leadIds.some(id=>!tokens[id]||!/^[A-Za-z0-9_-]{43}$/.test(tokens[id])))throw Error();return tokens;}catch{throw new AppError(409,'Material da revisão inválido. Gere uma nova revisão.');}
}
export function unsubscribeArtifact(token:string){try{const url=new URL(process.env.MAIL_PUBLIC_BASE_URL??'');if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')return null;return {url:new URL('/unsubscribe/'+token,url).toString(),hash:createHash('sha256').update(token).digest('hex')};}catch{return null;}}
