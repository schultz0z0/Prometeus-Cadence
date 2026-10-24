import type {OpenwaTickOptions} from '../../../domain/openwa.ts';
type Result={processed:number;failed:number};
export async function runOpenwaChannelTick(options:{now:string;signal?:AbortSignal},deps:{maintenance?:(options:OpenwaTickOptions)=>Promise<Result>;recovery?:(options:OpenwaTickOptions&{maxMessages:number})=>Promise<Result>}={}){
 if(options.signal?.aborted)return {processed:0,failed:0};
 const maintenance=deps.maintenance??(await import('./provisioning.ts')).runOpenwaMaintenanceTick;
 const result=await maintenance({...options,maxConnections:5});if(options.signal?.aborted)return result;
 const recovery=deps.recovery??(await import('./recovery.ts')).runOpenwaRecoveryTick,next=await recovery({...options,maxConnections:5,maxMessages:20});
 return {processed:result.processed+next.processed,failed:result.failed+next.failed};
}
