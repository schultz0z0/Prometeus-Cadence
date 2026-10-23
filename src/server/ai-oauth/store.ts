import {mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync,statSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {withOAuthLock,assertOAuthLock} from './lock.ts';
import {encryptCredential,decryptCredential,type EncryptedCredential} from '../channels/crypto.ts';
export interface OAuthConnection {id:string;workspaceId:string;hostId:string;revision:number;state:'disconnected'|'connected'|'attention';clientId:string|null;subject:string|null;email:string|null;model:string;models:{id:string;name:string}[];expiresAt:number;scopes:string[];lastError:string|null;refreshPending?:boolean}
export interface OAuthAttempt {workspaceId:string;connectionId:string;userId:string;sessionHash:string;revision:number;expiresAt:number;clientId?:string;subject?:string}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function createOAuthStore(root:string){
 const directory=resolve(root),path=(ws:string)=>join(directory,'connection-'+hash(ws)+'.json');
 const prepare=()=>mkdirSync(directory,{recursive:true,mode:0o700});
 const aad=(ws:string,id:string,revision:number)=>({workspaceId:ws,connectionId:id,revision,provider:'chatgpt-oauth' as const});
 function json(file:string){if(statSync(file).size>262144)throw Error('CHATGPT_STORAGE_INVALID');return JSON.parse(readFileSync(file,'utf8'));}
 function atomic(file:string,value:unknown){assertOAuthLock();prepare();const temporary=file+'.'+randomUUID()+'.tmp';try{writeFileSync(temporary,JSON.stringify(value),{mode:0o600,flag:'wx'});renameSync(temporary,file);}finally{try{unlinkSync(temporary);}catch{}}}
 function record(ws:string):{metadata:OAuthConnection;envelope:EncryptedCredential}|null{
  let raw;try{raw=json(path(ws));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  if(raw?.metadata?.workspaceId!==ws||!Number.isSafeInteger(raw.metadata.revision)||!['disconnected','connected','attention'].includes(raw.metadata.state)||!Array.isArray(raw.metadata.models))throw Error('CHATGPT_STORAGE_INVALID');return raw;
 }
 return {
  initial(ws:string):OAuthConnection{return {id:randomUUID(),workspaceId:ws,hostId:'urn:uuid:'+randomUUID(),revision:0,state:'disconnected',clientId:null,subject:null,email:null,model:'',models:[],expiresAt:0,scopes:[],lastError:null};},
  read(ws:string){return record(ws)?.metadata??null;},
  save(ws:string,metadata:OAuthConnection,secrets:Record<string,string>){if(metadata.workspaceId!==ws)throw Error('CHATGPT_WORKSPACE_MISMATCH');atomic(path(ws),{metadata,envelope:encryptCredential(secrets,aad(ws,metadata.id,metadata.revision))});},
  credentials(ws:string,revision:number){const value=record(ws);if(!value||value.metadata.revision!==revision)throw Error('CHATGPT_CONNECTION_CHANGED');return decryptCredential(value.envelope,aad(ws,value.metadata.id,revision));},
  putAttempt(state:string,metadata:OAuthAttempt,proof:Record<string,string>){prepare();for(const name of readdirSync(directory).filter(n=>/^attempt-[a-f0-9]{64}\.json$/.test(n)).slice(0,1000)){const file=join(directory,name);try{if(statSync(file).mtimeMs<Date.now()-600000)unlinkSync(file);}catch{}}atomic(join(directory,'attempt-'+hash(state)+'.json'),{metadata,envelope:encryptCredential(proof,aad(metadata.workspaceId,metadata.connectionId,metadata.revision))});},
  consumeAttempt(state:string){if(!/^[A-Za-z0-9_-]{43}$/.test(state))throw Error('CHATGPT_ATTEMPT_INVALID');const file=join(directory,'attempt-'+hash(state)+'.json'),consumed=file+'.'+randomUUID()+'.used';renameSync(file,consumed);try{const value=json(consumed) as {metadata:OAuthAttempt;envelope:EncryptedCredential};if(value.metadata.expiresAt<Date.now())throw Error('CHATGPT_ATTEMPT_EXPIRED');return {...value,proof:decryptCredential(value.envelope,aad(value.metadata.workspaceId,value.metadata.connectionId,value.metadata.revision))};}finally{unlinkSync(consumed);}},
  lock:withOAuthLock,
 };
}
export const oauthStore=createOAuthStore(join(process.cwd(),'.runtime','chatgpt-oauth'));
