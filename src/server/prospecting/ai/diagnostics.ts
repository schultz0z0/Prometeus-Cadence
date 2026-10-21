import {execFile} from 'node:child_process';import {isAbsolute} from 'node:path';
import type {CodexDiagnostic} from '../../../domain/ai-routing.ts';
import {verifiedCodexVersion} from './codex-runtime.ts';
export async function diagnoseCodex(run?:(args:string[])=>Promise<string>):Promise<CodexDiagnostic>{
 const absent:CodexDiagnostic={available:false,authenticated:false,authMode:'unknown',version:null,code:'CODEX_LOCAL_UNAVAILABLE'};
 let local=false;try{local=process.env.CADENCE_RUNTIME_MODE==='local'&&['127.0.0.1','localhost','[::1]'].includes(new URL(process.env.BETTER_AUTH_URL!).hostname);}catch{}
 const binary=process.env.CODEX_BINARY;if(!local||process.env.CODEX_LOCAL_ENABLED!=='true'||!binary||!isAbsolute(binary))return absent;
 const invoke=run??(args=>new Promise<string>((resolve,reject)=>execFile(binary,args,{windowsHide:true,timeout:args[0]==='--version'?5000:10000,maxBuffer:8192,env:diagnosticEnv()},(e,out,err)=>e?reject(Error('CODEX_AUTH_UNAVAILABLE')):resolve(out+err))));
 try{const version=(await invoke(['--version'])).trim();if(!verifiedCodexVersion(version))return{...absent,code:'CODEX_VERSION_NOT_VERIFIED'};const status=await invoke(['login','status']);if(status.length>8192)throw Error();const authenticated=/logged in/i.test(status)&&/ChatGPT/i.test(status);return{available:true,authenticated,authMode:authenticated?'chatgpt':'other',version,code:authenticated?null:'CODEX_CHATGPT_AUTH_REQUIRED'};}catch{return{...absent,code:'CODEX_AUTH_UNAVAILABLE'};}
}
function diagnosticEnv(){const env:NodeJS.ProcessEnv={NODE_ENV:'production'};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA'])if(process.env[key])env[key]=process.env[key];return env;}
