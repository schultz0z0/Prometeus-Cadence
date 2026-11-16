import type {ProviderUsage} from '../../../domain/prospecting.ts';
import {ProviderError} from '../providers/transport.ts';
import {conventionalSchema,conventionalPrompt,parseConventional,type ConventionalInput,type ConventionalResult} from './output.ts';
import {assertConventionalConfiguration,runConventionalJson,type ConventionalContext,type JsonDependencies} from './json.ts';
export {conventionalUnit,type ConventionalContext} from './json.ts';
export async function runConventional(ctx:ConventionalContext,input:ConventionalInput,deps:JsonDependencies={}):Promise<ConventionalResult>{
 assertConventionalConfiguration(ctx);
 const usage:ProviderUsage={provider:ctx.route.provider==='codex-local'?'codex':ctx.route.provider,operationId:ctx.operationId,units:{},costUsd:null,costKind:'unknown'};
 if(!input.evidence.length){if(input.task!=='qualify')throw new ProviderError('GENERATION_REQUIRES_EVIDENCE');return parseConventional({verdict:'insufficient_evidence',reason:'Não há evidências para avaliar.',evidenceIds:[]},input,ctx.route,usage);}
 // Thinking models spend the output budget before writing: 4096 left a qualification without a result (16/11/2026).
 const raw=await runConventionalJson(ctx,{prompt:conventionalPrompt(input),schema:conventionalSchema(input.task),maxOutputTokens:8192,parse:v=>v},deps);
 return parseConventional(raw.value,input,ctx.route,raw.usage);
}
export type {ConventionalInput,ConventionalResult} from './output.ts';
