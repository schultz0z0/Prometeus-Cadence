import type {AssistantReply,AssistantView,SearchPage} from '../domain/assistant-actions.ts';
// Every call carries the workspace it was made for; the server answers 409 if the session moved elsewhere.
async function call<T>(workspaceId:string,path:string,signal:AbortSignal,body?:unknown):Promise<T>{
 let response:Response;
 try{response=await fetch(path,{method:body===undefined?'GET':'POST',cache:'no-store',credentials:'same-origin',signal,
  headers:{'x-cadence-workspace':workspaceId,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
 catch(e){if(signal.aborted)throw e;throw Error('Sem conexão com o servidor. Sua pergunta foi mantida; tente de novo.');}
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw Object.assign(Error(data?.message??'Não foi possível falar com o servidor. Verifique sua conexão.'),{status:response.status});
 return data as T;
}
export const readAssistant=(workspaceId:string,signal:AbortSignal)=>call<AssistantView>(workspaceId,'/api/assistant',signal);
export const askAssistant=(workspaceId:string,input:{threadId?:string;text:string;contextRoute:string;requestId:string},signal:AbortSignal)=>call<AssistantReply>(workspaceId,'/api/assistant',signal,input);
export const searchWorkspace=(workspaceId:string,q:string,signal:AbortSignal,cursor?:string)=>call<SearchPage>(workspaceId,'/api/search?'+new URLSearchParams({q,...(cursor?{cursor}:{})}),signal);
