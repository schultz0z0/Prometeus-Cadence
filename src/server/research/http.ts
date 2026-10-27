import {z} from 'zod';
import {AppError,errorResponse} from '../errors.ts';
import {authorizeProspectingRequest,readProspectingBody} from '../prospecting/http.ts';
import {cancelJob} from '../prospecting/service.ts';
import {prepareCompanyResearch,confirmCompanyResearch,readCompanyResearch,latestCompanyResearch,prepareResearchApplication,confirmResearchApplication} from './company.ts';

const operation=z.discriminatedUnion('action',[
 z.strictObject({action:z.literal('prepare'),input:z.unknown()}),
 z.strictObject({action:z.literal('confirm'),input:z.unknown(),token:z.string(),requestId:z.string()}),
]);
export async function researchRequest(request:Request,id?:string,action?:string){
 try{
  const principal=await authorizeProspectingRequest(request),url=new URL(request.url);
  if(id&&(!id.length||id.length>120))throw new AppError(422,'Investigação inválida.');
  let result:unknown;
  if(request.method==='GET'){
   if(action)throw new AppError(405,'Método não permitido.');
   const leadId=url.searchParams.get('leadId')??undefined;
   if(leadId&&leadId.length>120)throw new AppError(422,'Contato inválido.');
   if(id)result=await readCompanyResearch(principal,id,{leadId});
   else if(leadId)result=await latestCompanyResearch(principal,leadId);
   else throw new AppError(422,'Selecione um contato ou investigação.');
  }else if(request.method==='POST'){
   const body=await readProspectingBody(request);
   if(!id){
    const parsed=operation.safeParse(body);if(!parsed.success)throw new AppError(422,'Operação inválida.');
    if(parsed.data.action==='prepare')result=await prepareCompanyResearch(principal,parsed.data.input);
    else{const {action:_action,...confirmation}=parsed.data;result=await confirmCompanyResearch(principal,confirmation);}
   }else if(action==='cancel'){
    await readCompanyResearch(principal,id);await cancelJob(principal,id);result=await readCompanyResearch(principal,id);
   }else if(action==='prepare-apply'||action==='apply'){
    const target=action==='prepare-apply'?body:body?.input;
    if(target?.caseId!==id)throw new AppError(409,'A investigação mudou. Revise novamente.');
    result=action==='prepare-apply'?await prepareResearchApplication(principal,body):await confirmResearchApplication(principal,body);
   }else throw new AppError(404,'Operação não encontrada.');
  }else throw new AppError(405,'Método não permitido.');
  return Response.json(result,{headers:{'cache-control':'no-store'}});
 }catch(error){return errorResponse(error);}
}
