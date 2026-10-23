import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import type {MessagingProvider} from '../../domain/messaging.ts';
export interface CredentialAAD {workspaceId:string;connectionId:string;provider:MessagingProvider|'chatgpt-oauth';revision:number}
export interface EncryptedCredential {keyId:string;iv:string;tag:string;ciphertext:string}
function keyring(){
 try{
  const raw=JSON.parse(process.env.CHANNEL_KEYRING_JSON??''),active=process.env.CHANNEL_ACTIVE_KEY_ID;
  if(!active||!raw||typeof raw!=='object'||Array.isArray(raw)||typeof raw[active]!=='string')throw Error();
  const keys=new Map<string,Buffer>();
  for(const [id,value] of Object.entries(raw)){
   if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id)||typeof value!=='string')throw Error();
   const key=Buffer.from(value,'base64');if(key.length!==32||key.toString('base64')!==value)throw Error();keys.set(id,key);
  }
  return {active,keys};
 }catch{throw Error('Chave de cifra indisponível ou inválida.');}
}
function aadBytes(aad:CredentialAAD){return Buffer.from(JSON.stringify([aad.workspaceId,aad.connectionId,aad.provider,aad.revision]));}
export function encryptCredential(value:Record<string,string>,aad:CredentialAAD):EncryptedCredential {
 const {active,keys}=keyring(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keys.get(active)!,iv);
 cipher.setAAD(aadBytes(aad));const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
 return {keyId:active,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:data.toString('base64')};
}
export function decryptCredential(value:EncryptedCredential,aad:CredentialAAD):Record<string,string> {
 try{
  const key=keyring().keys.get(value.keyId);if(!key)throw Error();
  const iv=Buffer.from(value.iv,'base64'),tag=Buffer.from(value.tag,'base64');if(iv.length!==12||tag.length!==16)throw Error();
  const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(aadBytes(aad));decipher.setAuthTag(tag);
  const raw=JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext,'base64')),decipher.final()]).toString('utf8'));
  if(!raw||Array.isArray(raw)||Object.values(raw).some(v=>typeof v!=='string'))throw Error();return raw;
 }catch{throw Error('Não foi possível decifrar esta credencial.');}
}
