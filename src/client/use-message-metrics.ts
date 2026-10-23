"use client";
import {useEffect,useState} from 'react';
import {useMessaging} from './workspace-provider';
import {useLiveRefresh} from './use-live-refresh';
import type {MessageMetrics} from '../domain/message-metrics';
export function useMessageMetrics(period:string,cadenceId=''){
 const client=useMessaging(),days=period==='Hoje'?1:period==='7 dias'?7:period==='90 dias'?90:30;
 const [metrics,setMetrics]=useState<MessageMetrics|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;setMetrics(null);if(client)client.metrics(days,cadenceId).then(value=>{if(active){setMetrics(value);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[client,days,cadenceId]);
 useLiveRefresh(async signal=>{if(!client)return;try{const value=await client.metrics(days,cadenceId);if(!signal.aborted){setMetrics(value);setError('');}}catch(e){if(!signal.aborted)setError((e as Error).message);throw e;}},15000,!!client,days+':'+cadenceId);
 return {metrics,error,live:!!client};
}
