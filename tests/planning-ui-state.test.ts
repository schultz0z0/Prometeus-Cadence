import test from 'node:test';
import assert from 'node:assert/strict';
import {initialPlanningFlow,planningFlowReducer} from '../src/client/planning-flow.ts';
import {mergeMessagePreview} from '../src/domain/cadence.ts';
import type {PlanningInput,PlanningReview} from '../src/domain/planning.ts';
const input:PlanningInput={kind:'planning',task:'audience_plan',description:'Clínicas',channel:'whatsapp',timezone:'UTC'};
const review={input,token:'proof',base:{contextVersion:1},usage:[],blockers:[]} as unknown as PlanningReview;
test('analysis confirmation creates no domain object and changed audience discards late proposals',()=>{
 let state=initialPlanningFlow(input);state=planningFlowReducer(state,{type:'review',epoch:0,review});assert.equal(state.created,null);assert.equal(state.jobId,null);
 state=planningFlowReducer(state,{type:'started',epoch:0,jobId:'job'});assert.equal(state.created,null);
 state=planningFlowReducer(state,{type:'input',input:{...input,channel:'email'}});assert.equal(state.jobId,null);assert.equal(state.review,null);assert.equal(state.previousJobId,'job');
 state=planningFlowReducer(state,{type:'result',jobId:'job',proposal:{task:'audience_plan',options:[]} as any});assert.equal(state.proposal,null);
});
test('selection retains human edits on retry and changing them invalidates an open confirmation',()=>{
 let state=initialPlanningFlow(input);state=planningFlowReducer(state,{type:'started',epoch:0,jobId:'job'});
 state=planningFlowReducer(state,{type:'select',optionId:'option_1',edits:{title:'Texto humano'}});
 const epoch=state.epoch;state=planningFlowReducer(state,{type:'selection-review',epoch,review:{optionId:'option_1',edits:state.edits,token:'p',expiresAt:'',effects:[],blockers:[]}});
 state=planningFlowReducer(state,{type:'failed',message:'Timeout'});assert.deepEqual(state.edits,{title:'Texto humano'});assert.equal(state.selectionReview?.token,'p');
 state=planningFlowReducer(state,{type:'edit',edits:{title:'Texto mais novo'}});assert.equal(state.selectionReview,null);
 state=planningFlowReducer(state,{type:'selection-review',epoch,review:{optionId:'option_1',edits:{title:'Texto humano'},token:'old',expiresAt:'',effects:[],blockers:[]}});assert.equal(state.selectionReview,null);
});
test('back navigation retains proposals while another generation requires a fresh cost review',()=>{
 let state=initialPlanningFlow(input);state=planningFlowReducer(state,{type:'started',epoch:0,jobId:'job'});
 const proposal={task:'audience_plan',options:[{id:'option_1'}]} as any;state=planningFlowReducer(state,{type:'result',jobId:'job',proposal});
 state=planningFlowReducer(state,{type:'select',optionId:'option_1',edits:{title:'A'}});state=planningFlowReducer(state,{type:'back'});assert.equal(state.proposal,proposal);assert.equal(state.view,'options');
 state=planningFlowReducer(state,{type:'new-review'});assert.equal(state.review,null);assert.equal(state.created,null);assert.equal(state.previousJobId,'job');assert.equal(state.jobId,null);
});
test('one-lead preview never overwrites a message edited during inference or changes cadence state',()=>{
 const base={id:'step',channel:'WHATSAPP' as const,body:'Salva',delayDays:2,stopOnReply:true},current={...base,body:'Edição humana'};
 assert.deepEqual(mergeMessagePreview(base,current,{body:'Proposta'}),{step:current,conflict:true});
 const accepted=mergeMessagePreview(base,base,{body:'Proposta {{nome}}'});assert.equal(accepted.step.body,'Proposta {{nome}}');assert.equal(accepted.step.delayDays,2);assert.equal(accepted.step.channel,'WHATSAPP');assert.equal(accepted.conflict,false);
});
test('history resume reads a saved proposal without authorizing another generation and cannot replace newer input',()=>{
 let state=initialPlanningFlow(input),proposal={task:'audience_plan',options:[]} as any;
 state=planningFlowReducer(state,{type:'resume',epoch:0,jobId:'saved',input,proposal});assert.equal(state.view,'options');assert.equal(state.review,null);assert.equal(state.jobId,'saved');
 state=planningFlowReducer(state,{type:'input',input:{...input,description:'Minha alteração'}});
 state=planningFlowReducer(state,{type:'resume',epoch:0,jobId:'old',input,proposal});assert.equal(state.input.task==='audience_plan'&&state.input.description,'Minha alteração');assert.equal(state.jobId,null);
});
