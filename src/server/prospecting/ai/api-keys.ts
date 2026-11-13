import {mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptCredential,decryptCredential,type EncryptedCredential} from '../../channels/crypto.ts';
import type {ApiKeyProvider,ApiKeyView} from '../../../domain/ai-routing.ts';
import {platformAiWorkspace} from './platform.ts';
// Platform keys entered by the AI admin. Stored beside the ChatGPT OAuth record, encrypted with the credential key; env stays the fallback.
interface Stored {metadata:ApiKeyView&{id:string;scope:string;provider:ApiKeyProvider};envelope:EncryptedCredential}
const directory=()=>join(process.cwd(),'.runtime','ai-keys'),path=(provider:ApiKeyProvider)=>join(directory(),provider+'.json');
const aad=(m:Stored['metadata'])=>({workspaceId:m.scope,connectionId:m.id,revision:m.revision,provider:m.provider});
function record(scope:string,provider:ApiKeyProvider):Stored|null{
 let raw:Stored;try{raw=JSON.parse(readFileSync(path(provider),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
 // A record written for another platform scope (or a test scope) is not this platform's key.
 return raw?.metadata?.scope===scope&&raw.metadata.provider===provider&&Number.isSafeInteger(raw.metadata.revision)?raw:null;
}
export function apiKeyView(scope:string,provider:ApiKeyProvider):ApiKeyView|null{const m=record(scope,provider)?.metadata;return m?{revision:m.revision,model:m.model,models:m.models,hint:m.hint,updatedAt:m.updatedAt}:null;}
export function storedApiKey(scope:string|null,provider:ApiKeyProvider):{key:string;model:string}|null{
 const value=scope?record(scope,provider):null;if(!value)return null;return {key:decryptCredential(value.envelope,aad(value.metadata)).key,model:value.metadata.model};
}
/** The key a provider call must use: the stored platform key, else the server environment. */
export function providerApiKey(provider:ApiKeyProvider):string{return storedApiKey(platformAiWorkspace(),provider)?.key??(provider==='openai'?process.env.OPENAI_API_KEY:process.env.GEMINI_API_KEY)??'';}
export function writeApiKey(scope:string,provider:ApiKeyProvider,expectedRevision:number,next:{key:string;model:string;models:string[]}|null):ApiKeyView|null{
 // shortcut: revision check without a cross-process lock; two admins saving in the same instant means last write wins.
 const current=record(scope,provider);if((current?.metadata.revision??0)!==expectedRevision)throw Error('AI_KEY_CHANGED');
 if(!next){try{unlinkSync(path(provider));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}return null;}
 const metadata:Stored['metadata']={id:current?.metadata.id??randomUUID(),scope,provider,revision:expectedRevision+1,model:next.model,models:next.models,hint:next.key.slice(-4),updatedAt:new Date().toISOString()};
 mkdirSync(directory(),{recursive:true,mode:0o700});const file=path(provider),temporary=file+'.'+randomUUID()+'.tmp';
 try{writeFileSync(temporary,JSON.stringify({metadata,envelope:encryptCredential({key:next.key},aad(metadata))}),{mode:0o600,flag:'wx'});renameSync(temporary,file);}finally{try{unlinkSync(temporary);}catch{}}
 return apiKeyView(scope,provider);
}
