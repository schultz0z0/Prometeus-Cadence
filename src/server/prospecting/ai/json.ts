import type {ConventionalRoute} from '../../../domain/ai-routing.ts';
import type {ProviderUsage,Unit} from '../../../domain/prospecting.ts';
import {conventionalConfig} from './config.ts';
import {ProviderError} from '../providers/transport.ts';
import type {Fetch} from '../providers/types.ts';
import {codexJson,type CodexRun} from './codex.ts';
import {openaiJson} from './openai.ts';
import {geminiJson} from './gemini.ts';
import {oauthStore} from '../../ai-oauth/store.ts';
import {oauthAccessToken} from '../../ai-oauth/session.ts';
import {chatgptJson} from '../../ai-oauth/protocol.ts';
export const conventionalUnit=(p:ConventionalRoute['provider']):Unit=>p==='codex-local'||p==='chatgpt-oauth'?'codexCalls':p==='openai'?'openaiCalls':'geminiCalls';
export interface ConventionalContext{operationId:string;workspaceId:string;signal:AbortSignal;route:ConventionalRoute;acquireSlot?:()=>Promise<boolean>;releaseSlot?:()=>Promise<void>}
export type JsonDependencies={fetcher?:Fetch;runCodex?:CodexRun;oauthSession?:typeof oauthAccessToken};
export function assertConventionalConfiguration(ctx:ConventionalContext){
 const configured=conventionalConfig(ctx.workspaceId).conventional[ctx.route.provider];
 if(process.env.PROSPECTING_ENABLED!=='true'||!configured?.configured||configured.route.configFingerprint!==ctx.route.configFingerprint)throw new ProviderError('AI_CONFIGURATION_CHANGED');
}
export async function ensureOAuthCompanion(workspaceId:string,route:ConventionalRoute,signal:AbortSignal=new AbortController().signal,fetcher?:Fetch,session=oauthAccessToken){
 if(route.provider!=='chatgpt-oauth')return null;
 const ctx={workspaceId,route,signal,operationId:'oauth-session'};assertConventionalConfiguration(ctx);
 const row=oauthStore.read(workspaceId);if(!row)throw new ProviderError('AI_CONFIGURATION_CHANGED');
 const token=await session(workspaceId,row.revision,{fetcher});
 assertConventionalConfiguration(ctx);signal.throwIfAborted();return token;
}
export async function runConventionalJson<T>(ctx:ConventionalContext,request:{prompt:string;schema:unknown;maxOutputTokens:number;parse:(raw:unknown)=>T},deps:JsonDependencies={}):Promise<{value:T;usage:ProviderUsage}>{
 assertConventionalConfiguration(ctx);
 if(![4096,8192].includes(request.maxOutputTokens))throw new ProviderError('INVALID_OUTPUT_BUDGET');
 let raw:{value:unknown;inputTokens?:number;outputTokens?:number};
 if(ctx.route.provider==='codex-local')raw={value:await codexJson({...ctx,run:deps.runCodex},request.prompt,request.schema)};
 else if(ctx.route.provider==='chatgpt-oauth'){
  const token=await ensureOAuthCompanion(ctx.workspaceId,ctx.route,ctx.signal,deps.fetcher,deps.oauthSession);
  raw=await chatgptJson(token!,ctx.route.model,request.prompt,request.schema,ctx.signal,deps.fetcher);
 }
 else raw=await(ctx.route.provider==='openai'?openaiJson:geminiJson)(ctx.route.model,request.prompt,request.schema,ctx.signal,deps.fetcher,request.maxOutputTokens);
 const usage:ProviderUsage={provider:ctx.route.provider==='codex-local'?'codex':ctx.route.provider,operationId:ctx.operationId,units:{[conventionalUnit(ctx.route.provider)]:1},inputTokens:raw.inputTokens,outputTokens:raw.outputTokens,costUsd:null,costKind:'unknown'};
 try{return {value:request.parse(raw.value),usage};}catch{throw new ProviderError('INVALID_CONVENTIONAL_RESULT',0,true);}
}
