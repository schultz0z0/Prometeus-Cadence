import {z} from 'zod';import type {Principal} from '../../../domain/workspace.ts';import {AppError} from '../../errors.ts';
import {requestOpenwaConnection,readOpenwaConnection,readOpenwaQr,requestOpenwaReconnect,requestOpenwaDisconnect} from './lifecycle.ts';
const create=z.strictObject({requestId:z.uuid(),expectedRevision:z.literal(0),name:z.string().trim().min(1).max(120)});
export async function openwaAction(p:Principal,request:Request,body:unknown,id:string,action?:string){
 if(id==='openwa'&&!action&&request.method==='POST'){
  const parsed=create.safeParse(body);if(!parsed.success)throw new AppError(422,'Configuração OpenWA inválida. Informe somente o nome da conexão.');
  const {requestId,name}=parsed.data;return requestOpenwaConnection(p,{requestId,name});
 }
 if(request.method==='GET'&&action==='openwa-status')return readOpenwaConnection(p,id);
 if(request.method==='GET'&&action==='openwa-qr'){
  const raw=new URL(request.url).searchParams.get('revision');if(!raw||!/^[1-9]\d{0,8}$/.test(raw))throw new AppError(422,'Revisão inválida.');return readOpenwaQr(p,id,Number(raw));
 }
 if(request.method==='POST'&&action==='openwa-reconnect')return requestOpenwaReconnect(p,id,body as Parameters<typeof requestOpenwaReconnect>[2]);
 if(request.method==='POST'&&action==='openwa-disconnect')return requestOpenwaDisconnect(p,id,body as Parameters<typeof requestOpenwaDisconnect>[2]);
 throw new AppError(405,'Método não permitido.');
}
