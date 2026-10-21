import type {ProspectingInput,Review,JobView,JobItemView,Page,ProviderCapabilities} from '../domain/prospecting.ts';
import type {AiSettingsView,AiPolicy,AiTestReview,CodexDiagnostic} from '../domain/ai-routing.ts';
import {createWorkspaceTransport} from './workspace-transport.ts';
export function createProspectingClient(options:{workspaceId:string;transport?:typeof fetch;onAccessLost?:(message:string)=>void}){
  const confirmations=new Map<string,Promise<JobView>>(),requestIds=new Map<string,string>(),applications=new Map<string,Promise<{applied:number;revision:number}>>();
  const settingsFlights=new Map<string,Promise<AiPolicy>>();
  const workspace=createWorkspaceTransport({...options,onAccessLost(message){confirmations.clear();applications.clear();requestIds.clear();settingsFlights.clear();options.onAccessLost?.(message);}});
  const request=<T>(path:string,body?:unknown)=>workspace.request<T>('/api/prospecting'+path,body);
  const stableId=(key:string)=>{let id=requestIds.get(key);if(!id){id=crypto.randomUUID();requestIds.set(key,id);}return id;};
  return{
    aiSettings:()=>request<AiSettingsView>('/ai/policy'),
    saveAiPolicy(policy:AiPolicy){const key='policy:'+JSON.stringify(policy),prior=settingsFlights.get(key);if(prior)return prior;
      const{revision,...values}=policy;const promise=request<AiPolicy>('/ai/policy',{requestId:stableId(key),expectedRevision:revision,policy:values}).then(result=>{requestIds.delete(key);settingsFlights.delete(key);return result;}).catch(e=>{settingsFlights.delete(key);throw e;});settingsFlights.set(key,promise);return promise;},
    diagnoseAi:()=>request<CodexDiagnostic>('/ai/diagnostics',{}),
    prepareAiTest:()=>request<AiTestReview>('/ai/test/prepare',{}),
    confirmAiTest(review:AiTestReview){const key='probe:'+review.draft.sampleId,flight=key+review.token,prior=confirmations.get(flight);if(prior)return prior;
      const promise=request<JobView>('/ai/test',{requestId:stableId(key),draft:review.draft,reviewToken:review.token}).then(result=>{requestIds.delete(key);return result;}).catch(e=>{confirmations.delete(flight);throw e;});confirmations.set(flight,promise);return promise;},
    capabilities:()=>request<ProviderCapabilities>('/capabilities'),
    prepare:(input:ProspectingInput)=>request<Review>('/prepare',input),
    confirm(review:Review){
      const key=JSON.stringify(review.input),flightKey=key+review.token,previous=confirmations.get(flightKey);if(previous)return previous;
      const promise=request<JobView>('/jobs',{requestId:stableId('confirm:'+key),input:review.input,reviewToken:review.token}).then(job=>{requestIds.delete('confirm:'+key);return job;}).catch(error=>{confirmations.delete(flightKey);throw error;});
      confirmations.set(flightKey,promise);return promise;
    },
    list:(cursor?:string)=>request<Page<JobView>>('/jobs'+(cursor?'?cursor='+encodeURIComponent(cursor):'')),
    get:(id:string)=>request<JobView>('/jobs/'+encodeURIComponent(id)),
    items:(id:string,cursor?:string)=>request<Page<JobItemView>>('/jobs/'+encodeURIComponent(id)+'/items'+(cursor?'?cursor='+encodeURIComponent(cursor):'')),
    cancel:(id:string)=>request<JobView>('/jobs/'+encodeURIComponent(id)+'/cancel',{}),
    apply(id:string,itemIds:string[]){
      const key=id+JSON.stringify([...itemIds].sort()),prior=applications.get(key);if(prior)return prior;
      const promise=request<{applied:number;revision:number}>('/jobs/'+encodeURIComponent(id)+'/apply',{requestId:stableId('apply:'+key),itemIds}).catch(error=>{applications.delete(key);throw error;});applications.set(key,promise);return promise;
    },
    reconcile:(id:string,body:{operationId?:string;runId?:string;confirmNotStarted?:true;resultUnavailable?:true})=>request<JobView>('/jobs/'+encodeURIComponent(id)+'/reconcile',body),
    dispose(){workspace.dispose();confirmations.clear();requestIds.clear();applications.clear();settingsFlights.clear();},
  };
}
export type ProspectingClient=ReturnType<typeof createProspectingClient>;
