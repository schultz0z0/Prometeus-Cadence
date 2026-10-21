"use client";
import {useEffect,useState,useSyncExternalStore} from 'react';
import {createMessagingFlow} from '@/client/messaging-flow';
export function useMessagingReview<T>(fingerprint:string){
 const [flow]=useState(()=>createMessagingFlow<T>(fingerprint));
 // Edits also invalidate synchronously in event handlers; this covers server
 // revisions and other props arriving independently of the local controls.
 useEffect(()=>{flow.edit(fingerprint);},[flow,fingerprint]);
 const state=useSyncExternalStore(flow.subscribe,flow.current,flow.current);
 return {flow,state};
}
