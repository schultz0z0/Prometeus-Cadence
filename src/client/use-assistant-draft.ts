"use client";
import {useEffect,useState} from 'react';
import {useIdentity} from './workspace-provider';
import {readDraft} from './assistant-client';
// A draft confirmed in the assistant opens its conversation with the composer filled; sending still needs the reply review.
export function useAssistantDraft(){
 const identity=useIdentity(),[draft,setDraft]=useState<{conversationId:string;text:string}|null>(null);
 useEffect(()=>{
  const ws=identity?.activeWorkspaceId,q=new URLSearchParams(window.location.search),id=q.get('draft'),conversation=q.get('conversation');
  if(!ws||!id||!conversation)return;const controller=new AbortController();
  readDraft(ws,id,controller.signal).then(d=>{if(d.conversationId===conversation)setDraft(d);}).catch(()=>{});
  return ()=>controller.abort();
 },[identity?.activeWorkspaceId]);
 return draft;
}
