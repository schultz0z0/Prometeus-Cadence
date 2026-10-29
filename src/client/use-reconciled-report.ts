"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {useDemo} from '@/demo/provider';
import {useReports} from './workspace-provider';
import {useLiveRefresh} from './use-live-refresh';
import {reportPeriodFromSelection,type ReportQuery,type ReportView} from '@/domain/reporting';
export function useReconciledReport(selection:string,view:ReportQuery['view']='dashboard',cadenceId=''){
 const client=useReports(),timezone=useDemo().preferences.timezone;
 const key=JSON.stringify([selection,timezone,view,cadenceId]),current=useRef({key,sequence:0});
 if(current.current.key!==key)current.current={key,sequence:current.current.sequence+1};
 const [state,setState]=useState<{key:string;report:ReportView|null;query:ReportQuery|null;error:string}>({key:'',report:null,query:null,error:''});
 const refresh=useCallback(async(signal?:AbortSignal)=>{
  if(!client)return;const sequence=++current.current.sequence;
  const active=()=>!signal?.aborted&&current.current.key===key&&current.current.sequence===sequence;
  try{const query:ReportQuery={...reportPeriodFromSelection(selection,timezone),view,...(cadenceId?{cadenceId}:{})},report=await client.read(query);if(active())setState({key,report,query,error:''});}
  catch(e){if(active())setState(old=>({key,report:old.key===key?old.report:null,query:old.key===key?old.query:null,error:(e as Error).message}));throw e;}
 },[client,key,selection,timezone,view,cadenceId]);
 useEffect(()=>{const controller=new AbortController();void refresh(controller.signal).catch(()=>{});return()=>controller.abort();},[refresh]);
 useLiveRefresh(refresh,15000,!!client,key);
 return{report:state.key===key?state.report:null,query:state.key===key?state.query:null,error:state.key===key?state.error:'',refresh,live:!!client};
}
