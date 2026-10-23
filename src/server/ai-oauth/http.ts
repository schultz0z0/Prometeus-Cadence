import 'server-only';
import {z} from 'zod';
import {authorizeProspectingRequest,readProspectingBody} from '../prospecting/http.ts';
import {requirePrincipal} from '../auth/principal.ts';
import {AppError,errorResponse} from '../errors.ts';
import {gmailCallbackUrl} from '../mail/callback-url.ts';
import {requireLocalOAuth} from './session.ts';
import {oauthView,startOAuth,finishOAuth,selectOAuthModel,disconnectOAuth} from './service.ts';
const revision={expectedRevision:z.number().int().nonnegative()};
export async function chatgptOAuthHttp(request:Request,action:string){
 try{
  const p=await authorizeProspectingRequest(request);
  if(action==='status'&&request.method==='GET')return Response.json(oauthView(p.workspaceId),{headers:{'cache-control':'no-store'}});
  if(request.method!=='POST')throw new AppError(405,'Método não permitido.');
  if(!['start','model','disconnect'].includes(action))throw new AppError(404,'Ação inexistente.');
  const schema=action==='model'?z.strictObject({...revision,model:z.string().regex(/^[a-zA-Z0-9._-]{1,120}$/)}):z.strictObject(revision);
  const parsed=schema.safeParse(await readProspectingBody(request));if(!parsed.success)throw new AppError(422,'Configuração ChatGPT inválida.');
  const b=parsed.data;const result=action==='start'?await startOAuth(p,b.expectedRevision):action==='model'?await selectOAuthModel(p,b.expectedRevision,(b as {model?:string}).model??''):await disconnectOAuth(p,b.expectedRevision);
  return Response.json(result,{headers:{'cache-control':'no-store','referrer-policy':'no-referrer'}});
 }catch(e){return errorResponse(e);}
}
export async function chatgptCallbackHttp(request:Request){
 const destination=new URL('/settings/ai',process.env.BETTER_AUTH_URL??'http://127.0.0.1:3210');
 try{
  const p=await requirePrincipal(request.headers),callback=gmailCallbackUrl(request,requireLocalOAuth());
  const result=await finishOAuth(p,callback);destination.searchParams.set('chatgpt',result.state==='connected'?'connected':result.lastError==='CHATGPT_PLAN_PERMISSION_REQUIRED'?'permission-required':'attention');
 }catch{destination.searchParams.set('chatgpt','failed');}
 // Do not log callback URLs, codes, OAuth state or token exchange responses.
 return new Response(null,{status:303,headers:{location:destination.href,'cache-control':'no-store','referrer-policy':'no-referrer'}});
}
