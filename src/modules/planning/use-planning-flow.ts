"use client";
import {useEffect,useReducer,useState} from 'react';
import {usePlanning,useWorkspaceRefresh} from '@/client/workspace-provider';
import {initialPlanningFlow,planningFlowReducer} from '@/client/planning-flow';
import type {PlanningInput} from '@/domain/planning';
import {usePlanningAnalysis} from './analysis-status';
export function usePlanningFlow(input:PlanningInput,resumeId?:string){
 const client=usePlanning(),refreshWorkspace=useWorkspaceRefresh(),[state,dispatch]=useReducer(planningFlowReducer,input,initialPlanningFlow),[busy,setBusy]=useState(false),analysis=usePlanningAnalysis(state.jobId);
 useEffect(()=>{let live=true;if(resumeId&&client)client.get(resumeId).then(data=>{if(live&&data.request.task===input.task)dispatch({type:'resume',epoch:0,input:data.request,jobId:data.job.id,proposal:data.proposal});}).catch(e=>{if(live)dispatch({type:'failed',message:e.message});});return()=>{live=false;};},[client,resumeId]);
 useEffect(()=>{if(analysis.data?.proposal)dispatch({type:'result',jobId:analysis.data.job.id,proposal:analysis.data.proposal});},[analysis.data]);
 async function action(fn:()=>Promise<void>){if(busy||!client)return;setBusy(true);try{await fn();}catch(e){dispatch({type:'failed',message:e instanceof Error?e.message:'Não foi possível concluir.'});}finally{setBusy(false);}}
 return {state,dispatch,busy,analysis,
  prepare:()=>action(async()=>{const review=await client!.prepare(state.input);dispatch({type:'review',epoch:state.epoch,review});}),
  confirm:()=>action(async()=>{if(!state.review)return;const job=await client!.confirm(state.review);dispatch({type:'started',epoch:state.epoch,jobId:job.id});}),
  prepareSelection:()=>action(async()=>{if(!state.jobId||!state.optionId||!state.edits)return;const review=await client!.prepareSelection(state.jobId,{optionId:state.optionId,edits:state.edits});dispatch({type:'selection-review',epoch:state.epoch,review});}),
  confirmSelection:()=>action(async()=>{if(!state.jobId||!state.selectionReview)return;const result=await client!.confirmSelection(state.jobId,state.selectionReview);dispatch({type:'created',epoch:state.epoch,result});await refreshWorkspace?.();}),
 };
}
