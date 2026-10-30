import'server-only';import{z}from'zod';import type{Principal}from'../../domain/workspace.ts';
import{defaultNotificationPreferences,notificationPreferencesSchema,nextSummary,type NotificationPreferences,type NotificationPreferenceView,type NotificationPage}from'../../domain/notifications.ts';
import{withWorkspaceTransaction}from'../db/transaction.ts';import{getPools}from'../db/pool.ts';import{AppError}from'../errors.ts';
export async function notificationPreferences(p:Principal):Promise<NotificationPreferenceView>{
 const row=await withWorkspaceTransaction(p,async c=>(await c.query('SELECT revision,payload FROM app.notification_preference')).rows[0]);
 const verified=(await getPools().authPool.query('SELECT "emailVerified" FROM auth."user" WHERE id=$1',[p.userId])).rows[0]?.emailVerified===true;
 return{revision:row?.revision??0,value:{...(row?.payload??defaultNotificationPreferences),expectedRevision:row?.revision??0},destinations:{email:verified?'verified':'pending',whatsapp:'pending',externalDelivery:process.env.NOTIFICATIONS_DELIVERY_ENABLED==='true'}};
}
export async function saveNotificationPreferences(p:Principal,input:NotificationPreferences){
 const parsed=notificationPreferencesSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Preferências inválidas. Confira eventos, horários e fuso.');const v=parsed.data;
 try{await withWorkspaceTransaction(p,async c=>{const timezone=v.quiet?.timezone??(await c.query("SELECT payload->>'timezone' zone FROM app.workspace_preferences")).rows[0]?.zone??'America/Sao_Paulo',next=v.summary.frequency==='off'?null:nextSummary(new Date().toISOString(),v.summary.frequency,v.summary.time,timezone);await c.query('SELECT app.save_notification_preferences($1,$2,$3)',[v.expectedRevision,v,next]);});}
 catch(e){if(e instanceof Error&&e.message==='NOTIFICATION_CONFLICT')throw new AppError(409,'As preferências mudaram. Atualize antes de salvar.');throw e;}return notificationPreferences(p);
}
const cursorSchema=z.strictObject({workspaceId:z.string(),userId:z.string(),at:z.string().datetime(),id:z.string().uuid()});
export async function listNotifications(p:Principal,cursor?:string):Promise<NotificationPage>{
 let after:z.infer<typeof cursorSchema>|null=null;if(cursor){try{if(cursor.length>1024||!/^[\w-]+$/.test(cursor))throw Error();after=cursorSchema.parse(JSON.parse(Buffer.from(cursor,'base64url').toString()));if(after.workspaceId!==p.workspaceId||after.userId!==p.userId)throw Error();}catch{throw new AppError(422,'Página de notificações inválida.');}}
 const data=await withWorkspaceTransaction(p,async c=>{
  const rows=(await c.query(`SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_at FROM app.notification_item WHERE ($1::timestamptz IS NULL OR(created_at,id)<($1::timestamptz,$2::text)) ORDER BY created_at DESC,id DESC LIMIT 31`,[after?.at??null,after?.id??null])).rows;
  const count=Number((await c.query('SELECT count(*) FROM app.notification_item WHERE read_at IS NULL')).rows[0].count),head=(await c.query('SELECT id,created_at FROM app.notification_item ORDER BY created_at DESC,id DESC LIMIT 1')).rows[0];
  const items=rows.slice(0,30).map(r=>({id:r.id,eventKey:r.event_key,title:r.title,href:r.href,createdAt:r.created_at.toISOString(),readAt:r.read_at?.toISOString()??null})),last=rows[29];
  return{items,unread:count,nextCursor:rows.length>30?Buffer.from(JSON.stringify({workspaceId:p.workspaceId,userId:p.userId,at:last.cursor_at,id:last.id})).toString('base64url'):null,latestKey:head?.id??null,latestAt:head?.created_at.toISOString()??null};
 });return{...data,preferences:await notificationPreferences(p)};
}
export async function readNotification(p:Principal,id:string){if(!z.string().uuid().safeParse(id).success)throw new AppError(404,'Notificação não encontrada.');return withWorkspaceTransaction(p,async c=>{if(!(await c.query('SELECT app.read_notification($1) found',[id])).rows[0].found)throw new AppError(404,'Notificação não encontrada.');return{read:true};});}
