import{z}from'zod';import{requirePrincipal}from'../auth/principal.ts';import{AppError,checkOrigin,errorResponse}from'../errors.ts';import{listNotifications,notificationPreferences,saveNotificationPreferences,readNotification}from'./service.ts';
const save=z.strictObject({action:z.literal('preferences'),expectedRevision:z.number().int().min(0),input:z.unknown()});
export async function notificationRequest(request:Request,id?:string,action?:string){
 try{const p=await requirePrincipal(request.headers),expected=request.headers.get('x-cadence-workspace');if(expected&&expected!==p.workspaceId)throw new AppError(409,'O workspace mudou. Atualize antes de continuar.','WORKSPACE_CHANGED');checkOrigin(request);
  const q=new URL(request.url).searchParams;if([...q.keys()].some(k=>!['mode','cursor'].includes(k))||[...new Set(q.keys())].some(k=>q.getAll(k).length!==1)||q.has('mode')&&q.get('mode')!=='preferences')throw new AppError(422,'Consulta de notificações inválida.');let result:unknown;
  if(id){if(request.method!=='POST'||action!=='read')throw new AppError(404,'Ação não encontrada.');const body=await request.json().catch(()=>null);if(!z.strictObject({}).safeParse(body).success)throw new AppError(422,'Pedido inválido.');result=await readNotification(p,id);}
  else if(request.method==='GET')result=q.get('mode')==='preferences'?await notificationPreferences(p):await listNotifications(p,q.get('cursor')??undefined);
  else if(request.method==='POST'){const body=save.safeParse(await request.json().catch(()=>null));if(!body.success||typeof body.data.input!=='object'||body.data.input===null)throw new AppError(422,'Preferências inválidas.');const input=body.data.input as Record<string,unknown>;if(input.expectedRevision!==body.data.expectedRevision)throw new AppError(422,'Revisão divergente.');result=await saveNotificationPreferences(p,input as any);}
  else return new Response(null,{status:405,headers:{allow:'GET, POST','cache-control':'no-store'}});
  return Response.json(result,{headers:{'cache-control':'no-store'}});
 }catch(e){return errorResponse(e);}
}
