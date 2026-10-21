import type {PlanningInput,PlanningReview,PlanningSelectionReview,PlanningProposal,PlanningEvidence} from '../domain/planning.ts';
import type {JobView} from '../domain/prospecting.ts';
import type {CompanyProfile,CadenceStep} from '../domain/model.ts';
import type {ProductProfile} from '../domain/products.ts';
import type {PlanningSelectionResult} from '../server/planning/confirmation.ts';
import {createWorkspaceTransport,type WorkspaceTransportOptions} from './workspace-transport.ts';
export interface PlanningAnalysis{job:JobView;request:PlanningInput;proposal:PlanningProposal|null;baseline:CompanyProfile|ProductProfile|null;sources:PlanningEvidence[];previewStep?:CadenceStep}
export function createPlanningClient(options:WorkspaceTransportOptions){
 const api=createWorkspaceTransport(options),ids=new Map<string,string>(),flights=new Map<string,Promise<any>>();
 const stable=(key:string)=>{let id=ids.get(key);if(!id){id=crypto.randomUUID();ids.set(key,id);}return id;};
 function confirm<T>(path:string,key:string,token:string,body:Record<string,unknown>):Promise<T>{
  const flightKey=key+token,old=flights.get(flightKey);if(old)return old;
  const promise=api.request<T>(path,{...body,requestId:stable(key),reviewToken:token}).then(result=>{ids.delete(key);return result;}).catch(e=>{flights.delete(flightKey);throw e;});flights.set(flightKey,promise);return promise;
 }
 return {
  prepare:(input:PlanningInput)=>api.request<PlanningReview>('/api/planning/prepare',input),
  confirm:(review:PlanningReview)=>confirm<JobView>('/api/planning/jobs','analysis:'+JSON.stringify(review.input),review.token,{input:review.input}),
  get:(id:string)=>api.request<PlanningAnalysis>('/api/planning/jobs/'+encodeURIComponent(id)),
  prepareSelection:(id:string,selection:{optionId:string;edits:unknown})=>api.request<PlanningSelectionReview>('/api/planning/jobs/'+encodeURIComponent(id)+'/confirm/prepare',selection),
  confirmSelection:(id:string,review:PlanningSelectionReview)=>confirm<PlanningSelectionResult>('/api/planning/jobs/'+encodeURIComponent(id)+'/confirm','selection:'+id+JSON.stringify({optionId:review.optionId,edits:review.edits}),review.token,{optionId:review.optionId,edits:review.edits}),
  dispose(){api.dispose();ids.clear();flights.clear();},
 };
}
export type PlanningClient=ReturnType<typeof createPlanningClient>;
