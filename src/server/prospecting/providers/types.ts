import type {CandidatePage,JobInput,RemoteRun,RemoteState,GenerationSource} from '../../../domain/prospecting.ts';
export type GenerationInput=Extract<JobInput,{kind:'generation'}>;
export interface ProviderProfile {source:GenerationSource;actor:string;build:string;ppe:boolean;partners?:boolean}
export interface ProviderContext{operationId:string;signal:AbortSignal;profile:ProviderProfile;credential:string;maxChargeUsd:number;maxPages:number}
export type StartResult={kind:'remote';run:RemoteRun}|{kind:'inline';page:CandidatePage}|{kind:'uncertain';operationId:string};
export interface SourceAdapter{start(ctx:ProviderContext,input:GenerationInput):Promise<StartResult>;poll(ctx:ProviderContext,run:RemoteRun):Promise<RemoteState>;readPage(ctx:ProviderContext,run:RemoteRun,cursor:string|null,limit?:number):Promise<CandidatePage>;abort(ctx:ProviderContext,run:RemoteRun):Promise<RemoteState>}
export type Fetch=typeof globalThis.fetch;
