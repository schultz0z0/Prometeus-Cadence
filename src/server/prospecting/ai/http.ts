import {authorizeProspectingRequest,readProspectingBody} from '../http.ts';import {errorResponse,AppError} from '../../errors.ts';import {getAiSettings,prepareAiTest,confirmAiTest} from './probe.ts';import {saveAiPolicy,requireAiAdmin} from './settings.ts';import {withWorkspaceTransaction} from '../../db/transaction.ts';import {conventionalConfig} from './config.ts';import {diagnoseCodex} from './diagnostics.ts';
export async function aiRequest(request:Request,action:'policy'|'diagnostics'|'prepare-test'|'confirm-test'){
 try{const p=await authorizeProspectingRequest(request);let result:unknown;
 if(action==='policy')result=request.method==='GET'?await getAiSettings(p):await saveAiPolicy(p,await readProspectingBody(request));
 else if(action==='prepare-test')result=await prepareAiTest(p);
 else if(action==='confirm-test')result=await confirmAiTest(p,await readProspectingBody(request));
 else{await withWorkspaceTransaction(p,requireAiAdmin);if(!conventionalConfig(p.workspaceId).conventional['codex-local'].configured)throw new AppError(409,'O Codex local não está autorizado neste workspace.');result=await diagnoseCodex();}
 return Response.json(result,{headers:{'cache-control':'no-store'}});
 }catch(e){return errorResponse(e);}
}
