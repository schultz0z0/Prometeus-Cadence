export type ConventionalProvider='codex-local'|'chatgpt-oauth'|'openai'|'gemini';
export type AiMode='auto'|'conventional-only'|'hybrid-required';
export interface AiPolicy{revision:number;mode:AiMode;conventionalProvider:ConventionalProvider|null;jevEnabled:boolean}
export interface ConventionalRoute{provider:ConventionalProvider;model:string;configFingerprint:string;contractVersion:'conventional-v1'}
export interface AiRoute{policyRevision:number;mode:AiMode;effectiveMode:'conventional'|'hybrid';conventional:ConventionalRoute;decisionProvider:ConventionalProvider|'jev'}
export type AiRouteView=Omit<AiRoute,'conventional'>&{conventional:Omit<ConventionalRoute,'configFingerprint'>};
export interface ConnectionCheck extends ConventionalRoute{checkedAt:string;outcome:'success'|'failed'|'uncertain';jobId:string;operationId:string;code?:string|null}
export interface AiRuntime{conventional:Record<ConventionalProvider,{configured:boolean;route:ConventionalRoute}>;jevReady:boolean}
export const defaultAiPolicy:AiPolicy={revision:0,mode:'auto',conventionalProvider:null,jevEnabled:true};
export function validConnectionCheck(route:ConventionalRoute,check:ConnectionCheck|null,now=Date.now()){
 return !!check&&check.outcome==='success'&&check.provider===route.provider&&check.model===route.model&&check.configFingerprint===route.configFingerprint&&check.contractVersion===route.contractVersion&&Date.parse(check.checkedAt)<=now&&Date.parse(check.checkedAt)>now-86400000;
}
export function resolveAiRoute(policy:AiPolicy,runtime:AiRuntime,check:ConnectionCheck|null,now=Date.now()):{route:AiRoute|null;blockers:string[]}{
 const p=policy.conventionalProvider,entry=p?runtime.conventional[p]:null;
 if(!entry?.configured)return{route:null,blockers:['Conecte e selecione uma LLM convencional para executar IA.']};
 const hybrid=policy.mode!=='conventional-only'&&policy.jevEnabled&&runtime.jevReady;
 if(policy.mode==='hybrid-required'&&!hybrid)return{route:null,blockers:['O modo híbrido obrigatório exige o JEV habilitado e configurado.']};
 if(hybrid&&!validConnectionCheck(entry.route,check,now))return{route:null,blockers:['Teste a LLM convencional nesta configuração antes de usar o JEV. O teste vale por 24 horas.']};
 return{route:{policyRevision:policy.revision,mode:policy.mode,effectiveMode:hybrid?'hybrid':'conventional',conventional:entry.route,decisionProvider:hybrid?'jev':p!},blockers:[]};
}
export function aiRouteView(route:AiRoute):AiRouteView{const{configFingerprint:_,...conventional}=route.conventional;return{...route,conventional};}
export interface CodexDiagnostic{available:boolean;authenticated:boolean;authMode:'chatgpt'|'other'|'unknown';version:string|null;code:string|null}
export interface AiSettingsView{policy:AiPolicy;canManage:boolean;providers:Record<ConventionalProvider,{configured:boolean;model:string}>;jevConfigured:boolean;route:AiRouteView|null;blockers:string[];lastCheck:Omit<ConnectionCheck,'configFingerprint'>|null;diagnostic?:CodexDiagnostic;chatgpt?:import('./chatgpt-oauth.ts').ChatGptOAuthView}
export interface AiTestDraft{sampleId:string}
export interface AiTestReview{draft:AiTestDraft;token:string;expiresAt:string;route:AiRouteView|null;usage:import('./prospecting.ts').UsageEstimate[];blockers:string[]}
