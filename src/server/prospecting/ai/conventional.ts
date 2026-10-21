import type {ConventionalRoute} from '../../../domain/ai-routing.ts';
import type {ProviderUsage,Unit} from '../../../domain/prospecting.ts';
import {conventionalConfig} from './config.ts';import {ProviderError} from '../providers/transport.ts';import type {Fetch} from '../providers/types.ts';
import {conventionalSchema,conventionalPrompt,parseConventional,type ConventionalInput,type ConventionalResult} from './output.ts';
import {codexJson,type CodexRun} from './codex.ts';import {openaiJson} from './openai.ts';import {geminiJson} from './gemini.ts';
export const conventionalUnit=(p:ConventionalRoute['provider']):Unit=>p==='codex-local'?'codexCalls':p==='openai'?'openaiCalls':'geminiCalls';
export interface ConventionalContext{operationId:string;workspaceId:string;signal:AbortSignal;route:ConventionalRoute;acquireSlot?:()=>Promise<boolean>;releaseSlot?:()=>Promise<void>}
export async function runConventional(ctx:ConventionalContext,input:ConventionalInput,deps:{fetcher?:Fetch;runCodex?:CodexRun}={}):Promise<ConventionalResult>{
 const configured=conventionalConfig(ctx.workspaceId).conventional[ctx.route.provider];
 if(process.env.PROSPECTING_ENABLED!=='true'||!configured?.configured||configured.route.configFingerprint!==ctx.route.configFingerprint)throw new ProviderError('AI_CONFIGURATION_CHANGED');
 const usage:ProviderUsage={provider:ctx.route.provider==='codex-local'?'codex':ctx.route.provider,operationId:ctx.operationId,units:{},costUsd:null,costKind:'unknown'};
 if(!input.evidence.length){if(input.task!=='qualify')throw new ProviderError('GENERATION_REQUIRES_EVIDENCE');return parseConventional({verdict:'insufficient_evidence',reason:'Não há evidências para avaliar.',evidenceIds:[]},input,ctx.route,usage);}
 const prompt=conventionalPrompt(input),schema=conventionalSchema(input.task);let raw:{value:unknown;inputTokens?:number;outputTokens?:number};
 if(ctx.route.provider==='codex-local')raw={value:await codexJson({...ctx,run:deps.runCodex},prompt,schema)};
 else raw=await(ctx.route.provider==='openai'?openaiJson:geminiJson)(ctx.route.model,prompt,schema,ctx.signal,deps.fetcher);
 return parseConventional(raw.value,input,ctx.route,{...usage,units:{[conventionalUnit(ctx.route.provider)]:1},inputTokens:raw.inputTokens,outputTokens:raw.outputTokens});
}
export type {ConventionalInput,ConventionalResult} from './output.ts';
