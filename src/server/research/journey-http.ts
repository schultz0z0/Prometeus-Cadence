import {z} from 'zod';
import {AppError,errorResponse} from '../errors.ts';
import {authorizeProspectingRequest,readProspectingBody} from '../prospecting/http.ts';
import {getJourney,journeyForJob,cancelJourney} from './journey.ts';
export async function journeyRequest(request:Request,id?:string,action?:string){try{
 const p=await authorizeProspectingRequest(request);if(id&&(!id.length||id.length>120))throw new AppError(422,'Jornada inválida.');let result:unknown;
 if(request.method==='GET'&&!id&&!action){const query=z.strictObject({id:z.string().min(1).max(120).optional(),jobId:z.string().min(1).max(120).optional()}).safeParse(Object.fromEntries(new URL(request.url).searchParams));if(!query.success||!!query.data.id===!!query.data.jobId)throw new AppError(422,'Selecione uma jornada ou execução.');result=query.data.id?await getJourney(p,query.data.id):await journeyForJob(p,query.data.jobId!);}
 else if(request.method==='POST'){
  // 06B.7: a jornada integrada é histórico; só a pausa continua aceita. Criar, retomar e gerar proposta abririam trabalho novo.
  if(!id||action!=='cancel')throw new AppError(409,'A Prospecção completa foi arquivada. Use o Gerador, o Qualificador e o Enriquecedor.','LEGACY_JOURNEY_ARCHIVED');
  if(!z.strictObject({}).safeParse(await readProspectingBody(request)).success)throw new AppError(422,'Operação inválida.');result=await cancelJourney(p,id);
 }else throw new AppError(405,'Método não permitido.');
 return Response.json(result,{headers:{'cache-control':'no-store'}});
}catch(e){return errorResponse(e);}}
