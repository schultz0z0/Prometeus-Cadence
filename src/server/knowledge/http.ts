import 'server-only';
import {AppError,errorResponse} from '../errors.ts';
import {authorizeProspectingRequest,readProspectingBody} from '../prospecting/http.ts';
import {deleteDocument,listDocuments,previewDocument,setDocumentState,uploadDocument} from './service.ts';
// /api/knowledge/documents (GET list, POST one file) and /api/knowledge/documents/:id/{approve,archive,delete,preview}.
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store'}});
const LIMIT=10*1024*1024;
async function readFile(request:Request){
 if(!request.headers.get('content-type')?.startsWith('multipart/form-data;'))throw new AppError(422,'Selecione um arquivo.');
 if(Number(request.headers.get('content-length'))>LIMIT+65536)throw new AppError(413,'O arquivo passa de 10 MB.');
 const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0;if(!reader)throw new AppError(422,'Selecione um arquivo.');
 while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>LIMIT+65536){await reader.cancel();throw new AppError(413,'O arquivo passa de 10 MB.');}chunks.push(next.value);}
 let data:FormData;try{data=await new Request(request.url,{method:'POST',headers:{'content-type':request.headers.get('content-type')!},body:Buffer.concat(chunks)}).formData();}catch{throw new AppError(422,'Arquivo inválido.');}
 const fields=[...data.entries()],file=data.get('file');if(fields.length!==1||fields[0][0]!=='file'||!(file instanceof File))throw new AppError(422,'Selecione um único arquivo.');
 return {name:file.name,bytes:new Uint8Array(await file.arrayBuffer())};
}
export async function knowledgeRequest(request:Request){
 try{
  const p=await authorizeProspectingRequest(request);
  if(request.method==='GET')return json(await listDocuments(p));
  if(request.method==='POST')return json(await uploadDocument(p,await readFile(request)),201);
  throw new AppError(405,'Método não permitido.');
 }catch(e){return errorResponse(e);}
}
export async function knowledgeItemRequest(request:Request,id:string,action:string){
 try{
  const p=await authorizeProspectingRequest(request);
  if(request.method==='GET'&&action==='preview')return json(await previewDocument(p,id));
  if(request.method!=='POST')throw new AppError(405,'Método não permitido.');
  if(action==='delete')return json(await deleteDocument(p,id));
  if(action==='approve'||action==='archive'){const body=await readProspectingBody(request) as Record<string,unknown>;return json(await setDocumentState(p,id,{expectedRevision:body?.expectedRevision,state:action==='approve'?'approved':'archived'}));}
  throw new AppError(404,'Recurso não encontrado.');
 }catch(e){return errorResponse(e);}
}
