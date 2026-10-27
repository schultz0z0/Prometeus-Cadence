import type {CompanyResearchInput,ResearchApplication,ResearchCaseView} from '../domain/company-research.ts';
import type {Reviewed} from '../domain/reviewed-operation.ts';
import {createWorkspaceTransport,type WorkspaceTransportOptions} from './workspace-transport.ts';
export function createResearchClient(options:WorkspaceTransportOptions){
 const transport=createWorkspaceTransport(options),ids=new Map<string,string>(),flights=new Map<string,Promise<unknown>>();
 const request=<T>(path:string,body?:unknown)=>transport.request<T>('/api/research'+path,body);
 function commit<T>(path:string,body:unknown,key:string):Promise<T>{
  const prior=flights.get(key);if(prior)return prior as Promise<T>;
  if(!ids.has(key))ids.set(key,crypto.randomUUID());
  const promise=request<T>(path,{...body as object,requestId:ids.get(key)}).finally(()=>flights.delete(key));
  flights.set(key,promise);return promise;
 }
 return{
  latest:(leadId:string)=>request<ResearchCaseView|null>('?leadId='+encodeURIComponent(leadId)),
  get:(id:string,leadId?:string)=>request<ResearchCaseView>('/'+encodeURIComponent(id)+(leadId?'?leadId='+encodeURIComponent(leadId):'')),
  prepare:(input:CompanyResearchInput)=>request<Reviewed<CompanyResearchInput>&{usage:{provider:string;units:Record<string,number>}[]}>('',{action:'prepare',input}),
  confirm(review:Reviewed<CompanyResearchInput>){return commit<ResearchCaseView>('',{action:'confirm',input:review.input,token:review.token},'confirm:'+review.token);},
  prepareApplication:(input:ResearchApplication)=>request<Reviewed<ResearchApplication>>('/'+encodeURIComponent(input.caseId)+'/prepare-apply',input),
  apply(review:Reviewed<ResearchApplication>){return commit<{applied:number}>('/'+encodeURIComponent(review.input.caseId)+'/apply',{input:review.input,token:review.token},'apply:'+review.token);},
  cancel:(id:string)=>request<ResearchCaseView>('/'+encodeURIComponent(id)+'/cancel',{}),
  dispose(){transport.dispose();flights.clear();ids.clear();},
 };
}
export type ResearchClient=ReturnType<typeof createResearchClient>;
