import {z} from 'zod';
import {channelHttp} from './request.ts';
import {readConnections,saveConnection,requireChannelAdmin,commandHash,priorCommand,completeCommand} from './repository.ts';
import {verifyConnection,disconnectConnection,readVerifyToken} from './connections.ts';
import {syncTemplates} from './templates.ts';
import {saveSenderLimits} from './limits.ts';
import {prepareChannelTest,confirmChannelTest} from '../messaging/replies.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {AppError} from '../errors.ts';
import {openwaAction} from './openwa/http.ts';
const actionSchema=z.strictObject({requestId:z.uuid(),expectedRevision:z.number().int().min(1)});
export function channelRequestHandler(request:Request,params:Record<string,string>):Promise<Response>{return channelHttp(request,async(p,body)=>{
 const {id,action}=params;if(id==='openwa'||action?.startsWith('openwa-'))return openwaAction(p,request,body,id,action);if(!id){if(request.method==='GET')return readConnections(p);if(request.method==='POST')return saveConnection(p,body);}
 if(request.method!=='POST')throw new AppError(405,'Método não permitido.');
 if(action==='test-prepare')return prepareChannelTest(p,id,body);
 if(action==='test-confirm')return confirmChannelTest(p,id,body);
 if(action==='limits')return saveSenderLimits(p,body);
 if(action==='disconnect')return disconnectConnection(p,{...(body as Record<string,unknown>),id});
 if(!['verify','sync-templates','verify-token'].includes(action))throw new AppError(404,'Ação não encontrada.');
 const parsed=actionSchema.safeParse(body);if(!parsed.success)throw new AppError(422,'Revisão da conexão inválida.');const b=parsed.data;
 if(action==='verify-token')return readVerifyToken(p,id);
 const hash=commandHash({action:'channel.'+action,id,input:b});
 const cached=await withWorkspaceTransaction(p,async c=>{await requireChannelAdmin(c);return priorCommand(c,p,b.requestId,hash);});if(cached!==undefined)return cached;
 const result=action==='verify'?await verifyConnection(p,id,b.expectedRevision):await syncTemplates(p,id,b.expectedRevision);
 return withWorkspaceTransaction(p,async c=>{await requireChannelAdmin(c);await lockWorkspace(c);const prior=await priorCommand(c,p,b.requestId,hash);if(prior!==undefined)return prior;await completeCommand(c,p,b.requestId,hash,result,'channel.'+action);return result;});
});}
