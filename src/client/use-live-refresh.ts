"use client";
import {useEffect,useRef} from 'react';
import {startPolling} from './live-refresh';
export function useLiveRefresh(run:(signal:AbortSignal)=>Promise<unknown>,intervalMs=15000,enabled=true,scope:unknown=''){
 const latest=useRef(run);latest.current=run;
 useEffect(()=>{
  if(!enabled)return;
  return startPolling(signal=>latest.current(signal),{intervalMs,environment:{
   available:()=>document.visibilityState!=='hidden'&&navigator.onLine,
   now:Date.now,random:Math.random,
   schedule:(fn,ms)=>{const timer=setTimeout(fn,ms);return()=>clearTimeout(timer);},
   subscribe:fn=>{document.addEventListener('visibilitychange',fn);window.addEventListener('online',fn);window.addEventListener('offline',fn);window.addEventListener('focus',fn);return()=>{document.removeEventListener('visibilitychange',fn);window.removeEventListener('online',fn);window.removeEventListener('offline',fn);window.removeEventListener('focus',fn);};},
  }});
 },[intervalMs,enabled,scope]);
}
