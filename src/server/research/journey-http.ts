import {z} from 'zod';
import {AppError,errorResponse} from '../errors.ts';
import {authorizeProspectingRequest,readProspectingBody} from '../prospecting/http.ts';
import {prepareJourney,confirmJourney,getJourney,journeyForJob,cancelJourney,prepareJourneyResume,resumeJourney,prepareJourneyCadence,confirmJourneyCadence} from './journey.ts';
const operation=z.discriminatedUnion('action',[z.strictObject({action:z.literal('prepare'),input:z.unknown()}),z.strictObject({action:z.literal('confirm'),input:z.unknown(),token:z.string(),requestId:z.string()})]);
export async function journeyRequest(request:Request,id?:string,action?:string){try{
 const p=await authorizeProspectingRequest(request);if(id&&(!id.length||id.length>120))throw new AppError(422,'Jornada inválida.');let result:unknown;
 if(request.method==='GET'&&!id&&!action){const query=z.strictObject({id:z.string().min(1).max(120).optional(),jobId:z.string().min(1).max(120).optional()}).safeParse(Object.fromEntries(new URL(request.url).searchParams));if(!query.success||!!query.data.id===!!query.data.jobId)throw new AppError(422,'Selecione uma jornada ou execução.');result=query.data.id?await getJourney(p,query.data.id):await journeyForJob(p,query.data.jobId!);}
 else if(request.method==='POST'){
  const body=await readProspectingBody(request);
  if(!id){const r=operation.safeParse(body);if(!r.success)throw new AppError(422,'Operação inválida.');const {action:op,...value}=r.data;result=op==='prepare'?await prepareJourney(p,value.input):await confirmJourney(p,value);}
  else if(action==='cancel'){if(!z.strictObject({}).safeParse(body).success)throw new AppError(422,'Operação inválida.');result=await cancelJourney(p,id);}
  else if(action==='resume'){if(body?.action==='prepare'&&Object.keys(body).length===1)result=await prepareJourneyResume(p,id);else if(body?.action==='confirm'){const {action:_action,...value}=body;result=await resumeJourney(p,id,value);}else throw new AppError(422,'Revise a retomada.');}
  else if(action==='prepare-cadence')result=await prepareJourneyCadence(p,id,body);
  else if(action==='confirm-cadence')result=await confirmJourneyCadence(p,id,body);
  else throw new AppError(404,'Operação não encontrada.');
 }else throw new AppError(405,'Método não permitido.');
 return Response.json(result,{headers:{'cache-control':'no-store'}});
}catch(e){return errorResponse(e);}}
