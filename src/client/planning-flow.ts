import type {PlanningInput,PlanningReview,PlanningProposal,PlanningSelectionReview} from '../domain/planning.ts';
import type {PlanningSelectionResult} from '../server/planning/confirmation.ts';
export interface PlanningFlow{input:PlanningInput;epoch:number;view:'input'|'analysis'|'options'|'edit'|'created';review:PlanningReview|null;jobId:string|null;previousJobId:string|null;proposal:PlanningProposal|null;optionId:string|null;edits:Record<string,unknown>|null;selectionReview:PlanningSelectionReview|null;created:PlanningSelectionResult|null;error:string}
export function initialPlanningFlow(input:PlanningInput):PlanningFlow{return {input,epoch:0,view:'input',review:null,jobId:null,previousJobId:null,proposal:null,optionId:null,edits:null,selectionReview:null,created:null,error:''};}
export type PlanningFlowEvent=
 |{type:'resume';epoch:number;input:PlanningInput;jobId:string;proposal:PlanningProposal|null}
 |{type:'input';input:PlanningInput}|{type:'new-review'}|{type:'review';epoch:number;review:PlanningReview}|{type:'dismiss-review'}
 |{type:'started';epoch:number;jobId:string}|{type:'result';jobId:string;proposal:PlanningProposal}
 |{type:'select';optionId:string;edits:Record<string,unknown>}|{type:'edit';edits:Record<string,unknown>}
 |{type:'selection-review';epoch:number;review:PlanningSelectionReview}|{type:'dismiss-selection'}
 |{type:'created';epoch:number;result:PlanningSelectionResult}|{type:'back'}|{type:'failed';message:string};
export function planningFlowReducer(s:PlanningFlow,event:PlanningFlowEvent):PlanningFlow{
 switch(event.type){
  case 'resume':return event.epoch===s.epoch?{...initialPlanningFlow(event.input),epoch:s.epoch,jobId:event.jobId,proposal:event.proposal,view:event.proposal?'options':'analysis'}:s;
  case 'input':return {...initialPlanningFlow(event.input),epoch:s.epoch+1,previousJobId:s.jobId??s.previousJobId};
  case 'new-review':return {...initialPlanningFlow(s.input),epoch:s.epoch+1,previousJobId:s.jobId??s.previousJobId};
  case 'review':return event.epoch===s.epoch?{...s,review:event.review,error:''}:s;
  case 'dismiss-review':return {...s,review:null};
  case 'started':return event.epoch===s.epoch?{...s,review:null,jobId:event.jobId,view:'analysis',error:''}:{...s,previousJobId:event.jobId};
  case 'result':return event.jobId===s.jobId?{...s,proposal:event.proposal,view:s.view==='analysis'?'options':s.view}:s;
  case 'select':return {...s,epoch:s.epoch+1,view:'edit',optionId:event.optionId,edits:structuredClone(event.edits),selectionReview:null,error:''};
  case 'edit':return {...s,epoch:s.epoch+1,edits:event.edits,selectionReview:null,error:''};
  case 'selection-review':return event.epoch===s.epoch?{...s,selectionReview:event.review,error:''}:s;
  case 'dismiss-selection':return {...s,selectionReview:null};
  case 'created':return event.epoch===s.epoch?{...s,view:'created',created:event.result,selectionReview:null,error:''}:s;
  case 'back':return {...s,view:s.proposal?'options':'input',selectionReview:null,error:''};
  case 'failed':return {...s,error:event.message};
 }
}
