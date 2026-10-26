import {requirePrincipal} from '../auth/principal.ts';
import {AppError,errorResponse} from '../errors.ts';
import {parseContactsQuery} from '../../domain/contacts-query.ts';
import {readContacts} from './repository.ts';
export async function contactsRequest(request:Request){
 if(request.method!=='GET')return new Response(null,{status:405,headers:{allow:'GET','cache-control':'no-store'}});
 try{const p=await requirePrincipal(request.headers),expected=request.headers.get('x-cadence-workspace');if(expected&&expected!==p.workspaceId)throw new AppError(409,'O workspace mudou. Recarregue antes de continuar.','WORKSPACE_CHANGED');
  let query;try{query=parseContactsQuery(new URL(request.url).searchParams);}catch{throw new AppError(422,'Consulta de contatos inválida.');}
  return Response.json(await readContacts(p,query),{headers:{'cache-control':'no-store'}});
 }catch(e){return errorResponse(e);}
}
