import type {AutomationActionReview,AutomationDefinition,AutomationRuntime,AutomationOccurrence} from '../domain/automation-runtime.ts';
import type {Page} from '../domain/prospecting.ts';
import {createWorkspaceTransport,type WorkspaceTransportOptions} from './workspace-transport.ts';
export function createAutomationClient(options:WorkspaceTransportOptions){
 const api=createWorkspaceTransport(options),ids=new Map<string,string>(),flights=new Map<string,Promise<any>>();
 function mutate<T>(id:string,action:string,body:Record<string,unknown>):Promise<T>{
  const key=JSON.stringify({id,action,...body}),old=flights.get(key);if(old)return old;
  let requestId=ids.get(key);if(!requestId){requestId=crypto.randomUUID();ids.set(key,requestId);}
  const result=api.request<T>('/api/automations/'+encodeURIComponent(id)+'/'+action,{...body,requestId}).then(data=>{ids.delete(key);return data;}).catch(e=>{flights.delete(key);throw e;});flights.set(key,result);return result;
 }
 return {
  list:()=>api.request<{definition:AutomationDefinition;runtime:AutomationRuntime}[]>('/api/automations'),
  prepare:(id:string,action:'activate'|'run-once',expectedRevision:number)=>api.request<AutomationActionReview>('/api/automations/'+encodeURIComponent(id)+'/prepare',{action,expectedRevision}),
  confirm:(id:string,review:AutomationActionReview)=>mutate<AutomationRuntime|AutomationOccurrence>(id,'confirm',{action:review.action,expectedRevision:review.expectedRevision,reviewToken:review.token}),
  pause:(id:string,expectedRevision:number)=>mutate<AutomationRuntime>(id,'pause',{expectedRevision}),
  occurrences:(id:string,cursor?:string)=>api.request<Page<AutomationOccurrence>>('/api/automations/'+encodeURIComponent(id)+'/occurrences'+(cursor?'?cursor='+encodeURIComponent(cursor):'')),
  dispose(){api.dispose();ids.clear();flights.clear();},
 };
}
export type AutomationClient=ReturnType<typeof createAutomationClient>;
