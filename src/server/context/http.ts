import {authorizeProspectingRequest,readProspectingBody} from '../prospecting/http.ts';
import {errorResponse} from '../errors.ts';
import {readContextState} from './repository.ts';
import {saveProduct} from './products.ts';
export async function contextRequest(request:Request,action:'get'|'save-product'){
 try{const p=await authorizeProspectingRequest(request),result=action==='get'?await readContextState(p):await saveProduct(p,await readProspectingBody(request));return Response.json(result,{headers:{'cache-control':'no-store'}});}catch(e){return errorResponse(e);}
}
