import 'server-only';
import QRCode from 'qrcode';
import {AppError,checkOrigin,errorResponse} from '../errors.ts';
import {prepareTotp,verifyTotp,disableTotp,completeSecondFactor} from './two-factor-policy.ts';

export async function twoFactorRequest(request:Request,action:string){
 try{
  checkOrigin(request);
  if(request.method!=='POST')throw new AppError(405,'Método não permitido.');
  if(!['prepare','verify','disable','recovery'].includes(action))throw new AppError(404,'Operação não encontrada.');
  if(Number(request.headers.get('content-length'))>2048)throw new AppError(422,'Requisição muito grande.');
  const text=await request.text();if(new TextEncoder().encode(text).byteLength>2048)throw new AppError(422,'Requisição muito grande.');
  let input;try{input=JSON.parse(text);}catch{throw new AppError(422,'Requisição inválida.');}
  const headers=new Headers({'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'});
  let result;
  if(action==='prepare'){const setup=await prepareTotp(request.headers,input);result={...setup,qr:await QRCode.toDataURL(setup.uri,{errorCorrectionLevel:'M',width:260,margin:2})};}
  else if(action==='verify')result=await verifyTotp(request.headers,input,headers);
  else if(action==='disable')result=await disableTotp(request.headers,input,headers);
  else result=await completeSecondFactor(request.headers,input,headers);
  return Response.json(result,{headers});
 }catch(e){return errorResponse(e);}
}
