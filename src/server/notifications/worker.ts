import'server-only';import{randomUUID}from'node:crypto';import{workerPool}from'../prospecting/worker-db.ts';import{summaryWindow}from'../../domain/notifications.ts';import{sendNotificationMail,notificationMailAvailable}from'../auth/mail.ts';
export type NotificationEmail={to:string;title:string;href:string};
export async function processNotificationTick(options:{limit:number;signal:AbortSignal},deps:{now?:()=>string;sendEmail?:(input:NotificationEmail)=>Promise<void>}={}){
 if(!Number.isInteger(options.limit)||options.limit<1||options.limit>100)throw Error('Invalid notification batch');const pool=workerPool(),now=deps.now?.()??new Date().toISOString();if(!Number.isFinite(Date.parse(now)))throw Error('Invalid notification time');let delivered=0,deferred=0;
 if(options.signal.aborted)return{delivered,deferred};
 for(const row of(await pool.query('SELECT * FROM app.notification_workspaces($1)',[options.limit])).rows){if(options.signal.aborted)break;await pool.query('SELECT app.notification_project($1,$2)',[row.workspace_id,options.limit]);}
 for(const row of(await pool.query('SELECT * FROM app.notification_summaries($1,$2)',[options.limit,now])).rows){if(options.signal.aborted)break;const pref=row.preferences,s=summaryWindow(now,pref.summary.frequency,pref.summary.time,row.timezone);await pool.query('SELECT app.notification_summary($1,$2,$3,$4,$5,$6,$7)',[row.workspace_id,row.user_id,pref.expectedRevision+1,s.from,s.to,s.next,now]);}
 if(process.env.NOTIFICATIONS_DELIVERY_ENABLED!=='true'||!deps.sendEmail&&!notificationMailAvailable())return{delivered,deferred:1};
 for(let i=0;i<options.limit&&!options.signal.aborted;i++){
  const token=randomUUID(),delivery=(await pool.query('SELECT app.notification_claim(coalesce($1::timestamptz,clock_timestamp()),$2) value',[deps.now?.()??null,token])).rows[0].value;if(!delivery)break;
  let accepted=false;try{if(options.signal.aborted){deferred++;break;}await(deps.sendEmail??sendNotificationMail)({to:delivery.to,title:delivery.title,href:delivery.href});accepted=true;delivered++;}catch{deferred++;}
  finally{await pool.query('SELECT app.notification_receipt($1,$2,$3)',[token,accepted,now]);}
 }return{delivered,deferred};
}
