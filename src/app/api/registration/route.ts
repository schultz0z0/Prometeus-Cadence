import { registrationSnapshot, completeRegistration } from '@/server/auth/registration';
import { checkOrigin, errorResponse, AppError } from '@/server/errors';
export const runtime='nodejs';
export async function GET(request:Request) {
 try{return Response.json(await registrationSnapshot(request.headers),{headers:{'cache-control':'no-store'}});}catch(e){return errorResponse(e);}
}
export async function POST(request:Request) {
 try{
  checkOrigin(request);
  const text=await request.text();if(text.length>4096)throw new AppError(422,'Dados de cadastro inválidos.');
  let body;try{body=JSON.parse(text);}catch{throw new AppError(422,'Dados de cadastro inválidos.');}
  return Response.json(await completeRegistration(request.headers,body),{headers:{'cache-control':'no-store'}});
 }catch(e){return errorResponse(e);}
}
