import type {Principal} from '../../domain/workspace.ts';import type {MessageMetrics} from '../../domain/message-metrics.ts';
import {reportPeriodForDays} from '../../domain/reporting.ts';import {localDateAt} from '../../domain/schedule.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';import {AppError} from '../errors.ts';import {readReport} from '../operations/reports.ts';
import {authorizeReport} from '../operations/projections.ts';
export async function readMessageMetrics(p:Principal,options:{days:number;cadenceId?:string}):Promise<MessageMetrics>{
 if(!Number.isInteger(options.days)||options.days<1||options.days>90||options.cadenceId&&options.cadenceId.length>200)throw new AppError(422,'Período inválido.');
 const timezone=await withWorkspaceTransaction(p,async c=>(await c.query("SELECT coalesce(payload->>'timezone','America/Sao_Paulo') zone FROM app.workspace_preferences")).rows[0]?.zone??'America/Sao_Paulo');
 let period;try{period=reportPeriodForDays(options.days,timezone);}catch{throw new AppError(422,'Revise o fuso horário do workspace.');}
 const zero={email:0,whatsapp:0,replies:0,failed:0,pending:0};let report;
 try{report=await readReport(p,{view:'dashboard',...period,...(options.cadenceId?{cadenceId:options.cadenceId}:{})});}catch(e){if(!(e instanceof AppError)||e.status!==404||!options.cadenceId)throw e;return{...zero,sent:0,bounces:0,optouts:0,period,today:{...zero},cadenceQueue:{today:0,later:0},series:[],tracking:{opens:null,clicks:null}};}
 const cadenceQueue=await readCadenceQueue(p,period.to,options.cadenceId);
 const total=report.totals,today=report.series.find(d=>d.date===localDateAt(new Date().toISOString(),timezone))?.values??zero;
 return{period,sent:total.sent??0,email:total.email??0,whatsapp:total.whatsapp??0,replies:total.replies??0,failed:total.failed??0,pending:total.pending??0,optouts:total.optouts??0,bounces:total.bounces??0,today:{email:today.email??0,whatsapp:today.whatsapp??0,replies:today.replies??0,failed:today.failed??0,pending:today.pending??0},cadenceQueue,series:report.series.map(d=>({date:d.date,sent:d.values.sent??0,replies:d.values.replies??0})),tracking:{opens:null,clicks:null}};
}

export async function readCadenceQueue(p:Principal,until:string,cadenceId?:string){
 return withWorkspaceTransaction(p,async c=>{
  await authorizeReport(c,p);
  return (await c.query<{today:number;later:number}>(`
   SELECT count(*) FILTER (WHERE coalesce(o.next_at,e.next_at)<$2)::int today,
          count(*) FILTER (WHERE coalesce(o.next_at,e.next_at)>=$2)::int later
   FROM app.cadence_enrollment e
   JOIN app.cadence_publication cp ON cp.workspace_id=e.workspace_id AND cp.id=e.publication_id
   LEFT JOIN app.message_outbox o ON o.workspace_id=e.workspace_id AND o.enrollment_id=e.id AND o.step_index=e.next_step
   WHERE e.workspace_id=$1 AND e.state='active' AND cp.state='active'
     AND ($3::text IS NULL OR cp.cadence_id=$3)
     AND (o.state IN ('pending','dispatching') OR (o.message_id IS NULL AND NOT e.schedule_pending))
  `,[p.workspaceId,until,cadenceId??null])).rows[0];
 });
}
