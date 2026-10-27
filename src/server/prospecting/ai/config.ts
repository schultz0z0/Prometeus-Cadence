import {isAbsolute} from 'node:path';
import {existsSync} from 'node:fs';
import {hashValue} from '../review.ts';
import type {AiRuntime,ConventionalProvider} from '../../../domain/ai-routing.ts';
import {oauthStore} from '../../ai-oauth/store.ts';
import {localOAuthRedirect} from '../../ai-oauth/session.ts';
import {AI_SKILLS_VERSION} from '../../../domain/ai-skills.ts';
import {platformAiWorkspace} from './platform.ts';
export function conventionalConfig(workspaceId:string):AiRuntime{
 const e=process.env,scope=platformAiWorkspace();let local=false;try{local=e.CADENCE_RUNTIME_MODE==='local'&&['127.0.0.1','localhost','[::1]'].includes(new URL(e.BETTER_AUTH_URL!).hostname);}catch{}
 const allow=(e.CODEX_TEST_WORKSPACE_IDS??'').split(',').map(x=>x.trim());
 const models={'codex-local':e.CODEX_MODEL??'',openai:e.OPENAI_MODEL??'',gemini:e.GEMINI_MODEL??''};
 const keys={'codex-local':'',openai:e.OPENAI_API_KEY??'',gemini:e.GEMINI_API_KEY??''};
 const ready={'codex-local':local&&e.CODEX_LOCAL_ENABLED==='true'&&!!scope&&allow.includes(scope)&&!!e.CODEX_BINARY&&isAbsolute(e.CODEX_BINARY)&&existsSync(e.CODEX_BINARY),openai:!!scope&&!!keys.openai,gemini:!!scope&&!!keys.gemini};
 const conventional=Object.fromEntries((Object.keys(models) as (keyof typeof models)[]).map(provider=>[provider,{configured:ready[provider]&&/^[a-zA-Z0-9._-]{1,120}$/.test(models[provider]),route:{provider,model:models[provider],contractVersion:'conventional-v1',configFingerprint:hashValue({skills:AI_SKILLS_VERSION,scope,provider,model:models[provider],key:keys[provider],...(provider==='codex-local'?{binary:e.CODEX_BINARY,local,allow}:{}),contract:'conventional-v1'})}}])) as AiRuntime['conventional'];
 const oauth=scope?oauthStore.read(scope):null,provider='chatgpt-oauth' as const;
 conventional[provider]={configured:!!localOAuthRedirect()&&oauth?.state==='connected'&&!!oauth.model,route:{provider,model:oauth?.model??'',contractVersion:'conventional-v1',configFingerprint:hashValue({skills:AI_SKILLS_VERSION,scope,provider,id:oauth?.id,revision:oauth?.revision,subject:oauth?.subject,model:oauth?.model,contract:'conventional-v1'})}};
 return{conventional,jevReady:!!e.OPENROUTER_API_KEY&&(e.JEV_MODEL??'typesafe/jev-1.13')==='typesafe/jev-1.13'};
}
