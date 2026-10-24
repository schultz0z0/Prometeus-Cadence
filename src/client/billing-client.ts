import type {BillingView,BillingReview,BillingOperation} from '../domain/billing';
import {createWorkspaceTransport,type WorkspaceTransportOptions} from './workspace-transport';
import {createReviewedCommands} from './channel-client';
export function createBillingClient(options:WorkspaceTransportOptions){
 const api=createWorkspaceTransport(options),commands=createReviewedCommands(api);
 return {
  read:()=>api.request<BillingView>('/api/billing'),
  trial:(intent:object)=>commands.run<BillingView>(intent,'/api/billing/trial',{}),
  prepare:(input:{kind:BillingReview['kind'];sku?:string})=>api.request<BillingReview>('/api/billing/prepare',input),
  confirm:(review:BillingReview)=>commands.run<BillingOperation>(review,'/api/billing/confirm',{review}),
  contact:(input:{expectedRevision:number;email:string|null;phone:string|null})=>commands.run<BillingView>(input,'/api/billing/contact',input),
  reconcile:()=>api.request<BillingView>('/api/billing/reconcile',{}),
  dispose(){commands.clear();api.dispose();},
 };
}
export type BillingClient=ReturnType<typeof createBillingClient>;
