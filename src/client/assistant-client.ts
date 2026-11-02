import type {AssistantProposal,AssistantReply,AssistantView,SearchPage} from '../domain/assistant-actions.ts';
export interface ProposalReview{proposal:AssistantProposal;review:{token:string;expiresAt:string;blockers:string[];warnings:string[];usage?:{unit:string;maxUnits:number}[]}}
// Every call carries the workspace it was made for; the server answers 409 if the session moved elsewhere.
async function call<T>(workspaceId:string,path:string,signal:AbortSignal,body?:unknown):Promise<T>{
 let response:Response;
 try{response=await fetch(path,{method:body===undefined?'GET':'POST',cache:'no-store',credentials:'same-origin',signal,
  headers:{'x-cadence-workspace':workspaceId,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
 catch(e){if(signal.aborted)throw e;throw Error('Sem conexão com o servidor. Tente de novo.');}
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw Object.assign(Error(data?.message??'Não foi possível falar com o servidor. Verifique sua conexão.'),{status:response.status});
 return data as T;
}
export const readAssistant=(workspaceId:string,signal:AbortSignal)=>call<AssistantView>(workspaceId,'/api/assistant',signal);
export const askAssistant=(workspaceId:string,input:{threadId?:string;text:string;contextRoute:string;requestId:string},signal:AbortSignal)=>call<AssistantReply>(workspaceId,'/api/assistant',signal,input);
export const searchWorkspace=(workspaceId:string,q:string,signal:AbortSignal,cursor?:string)=>call<SearchPage>(workspaceId,'/api/search?'+new URLSearchParams({q,...(cursor?{cursor}:{})}),signal);
const item=(id:string,action:string)=>'/api/assistant/'+encodeURIComponent(id)+'/'+action;
export const prepareProposal=(workspaceId:string,id:string,signal:AbortSignal)=>call<ProposalReview>(workspaceId,item(id,'prepare'),signal,{});
export const confirmProposal=(workspaceId:string,id:string,input:{token:string;requestId:string},signal:AbortSignal)=>call<{proposal:AssistantProposal;entityId:string;href:string}>(workspaceId,item(id,'confirm'),signal,input);
export const cancelProposal=(workspaceId:string,id:string,signal:AbortSignal)=>call<AssistantProposal>(workspaceId,item(id,'cancel'),signal,{});
export const readDraft=(workspaceId:string,id:string,signal:AbortSignal)=>call<{conversationId:string;text:string}>(workspaceId,item(id,'draft'),signal);
export const readOnboarding=(workspaceId:string,signal:AbortSignal)=>call<{tours:{id:string;completedAt:string}[]}>(workspaceId,'/api/onboarding',signal);
export const markTour=(workspaceId:string,tour:string,signal:AbortSignal)=>call<{tours:{id:string;completedAt:string}[]}>(workspaceId,'/api/onboarding',signal,{tour});
