export function parseMessagingOptions(args:string[]){
 const allowed=new Set(['--once','--allow-dispatch','--allow-sync','--all-workspaces','--workspace','--message','--max-messages']),seen=new Set<string>();
 let workspaceId:string|undefined,messageId:string|undefined,maxMessages=1;
 for(let i=0;i<args.length;i++){
  const arg=args[i];if(!allowed.has(arg)||seen.has(arg))throw Error('Invalid messaging option');seen.add(arg);
  if(arg==='--workspace'){workspaceId=args[++i];if(!workspaceId||workspaceId.startsWith('--')||workspaceId.length>120)throw Error('Invalid workspace');}
  if(arg==='--message'){messageId=args[++i];if(!messageId||messageId.startsWith('--')||messageId.length>120)throw Error('Invalid message');}
  if(arg==='--max-messages'){const raw=args[++i];if(!raw||!/^\d+$/.test(raw))throw Error('Invalid message limit');maxMessages=Number(raw);if(maxMessages<1||maxMessages>100)throw Error('Invalid message limit');}
 }
 if(workspaceId&&seen.has('--all-workspaces'))throw Error('Select one workspace scope');
 const allowDispatch=seen.has('--allow-dispatch');if(allowDispatch&&!workspaceId&&!seen.has('--all-workspaces'))throw Error('Explicit workspace scope required');
 if(messageId&&(!workspaceId||!seen.has('--once')||maxMessages!==1))throw Error('One-message pilot requires one workspace, --once and max 1');
 return {allowSync:seen.has('--allow-sync'),once:seen.has('--once'),allowDispatch,workspaceId,messageId,maxMessages};
}
