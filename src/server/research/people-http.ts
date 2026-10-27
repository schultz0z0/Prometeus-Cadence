import {AppError,errorResponse} from '../errors.ts';
import {authorizeProspectingRequest,readProspectingBody} from '../prospecting/http.ts';
import {readCompanyPeople,latestCompanyPeople,preparePeopleApplication,confirmPeopleApplication} from './people.ts';
export async function peopleRequest(request:Request,id?:string){try{
 const p=await authorizeProspectingRequest(request),url=new URL(request.url),leadId=url.searchParams.get('leadId')??undefined;
 if(id&&id.length>120||leadId&&leadId.length>120)throw new AppError(422,'Investigação inválida.');let result:unknown;
 if(request.method==='GET'){if(id)result=await readCompanyPeople(p,id,leadId);else if(leadId)result=await latestCompanyPeople(p,leadId);else throw new AppError(422,'Selecione uma empresa.');}
 else if(request.method==='POST'&&id){const body=await readProspectingBody(request);if(!body||!['prepare-apply','confirm-apply'].includes(body.action)||Object.keys(body).some(k=>!['action','personIds','expectedRevision','token','requestId'].includes(k)))throw new AppError(422,'Operação inválida.');const input={caseId:id,personIds:body.personIds,expectedRevision:body.expectedRevision};result=body.action==='prepare-apply'?await preparePeopleApplication(p,input):await confirmPeopleApplication(p,{input,token:body.token,requestId:body.requestId});}
 else throw new AppError(405,'Método não permitido.');return Response.json(result,{headers:{'cache-control':'no-store'}});
 }catch(e){return errorResponse(e);}}
