import {isAbsolute} from 'node:path';
import {existsSync} from 'node:fs';
import {hashValue} from '../review.ts';
import type {AiRuntime,ConventionalProvider} from '../../../domain/ai-routing.ts';
export function conventionalConfig(workspaceId:string):AiRuntime{
 const e=process.env;let local=false;try{local=e.CADENCE_RUNTIME_MODE==='local'&&['127.0.0.1','localhost','[::1]'].includes(new URL(e.BETTER_AUTH_URL!).hostname);}catch{}
 const allow=(e.CODEX_TEST_WORKSPACE_IDS??'').split(',').map(x=>x.trim());
 const models={'codex-local':e.CODEX_MODEL??'',openai:e.OPENAI_MODEL??'',gemini:e.GEMINI_MODEL??''};
 const keys={'codex-local':'',openai:e.OPENAI_API_KEY??'',gemini:e.GEMINI_API_KEY??''};
 const ready={'codex-local':local&&e.CODEX_LOCAL_ENABLED==='true'&&allow.includes(workspaceId)&&!!e.CODEX_BINARY&&isAbsolute(e.CODEX_BINARY)&&existsSync(e.CODEX_BINARY),openai:!!keys.openai,gemini:!!keys.gemini};
 const conventional=Object.fromEntries((Object.keys(models) as ConventionalProvider[]).map(provider=>[provider,{configured:ready[provider]&&/^[a-zA-Z0-9._-]{1,120}$/.test(models[provider]),route:{provider,model:models[provider],contractVersion:'conventional-v1',configFingerprint:hashValue({provider,model:models[provider],key:keys[provider],...(provider==='codex-local'?{binary:e.CODEX_BINARY,local,allow}:{}),contract:'conventional-v1'})}}])) as AiRuntime['conventional'];
 return{conventional,jevReady:!!e.OPENROUTER_API_KEY&&(e.JEV_MODEL??'typesafe/jev-1.13')==='typesafe/jev-1.13'};
}
