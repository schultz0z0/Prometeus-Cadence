import type {Principal} from '../../domain/workspace.ts';
import type {MessageMetrics} from '../../domain/message-metrics.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
export async function readMessageMetrics(p:Principal,options:{days:number;cadenceId?:string}):Promise<MessageMetrics>{
 if(!Number.isInteger(options.days)||options.days<1||options.days>90||options.cadenceId&&options.cadenceId.length>200)throw new AppError(422,'Período inválido.');
 return withWorkspaceTransaction(p,async c=>{
  const timezone=(await c.query("SELECT coalesce(payload->>'timezone','America/Sao_Paulo') AS zone FROM app.workspace_preferences")).rows[0]?.zone??'America/Sao_Paulo';
  let queryZone:string;
  try{
   const canonical=new Intl.DateTimeFormat('en',{timeZone:timezone}).resolvedOptions().timeZone;
   // Intl uses ISO offset signs; PostgreSQL timezone text uses the POSIX sign.
   queryZone=/^[+-]\d{2}:\d{2}$/.test(canonical)?'UTC'+(canonical[0]==='+'?'-':'+')+canonical.slice(1):canonical;
  }catch{throw new AppError(422,'Revise o fuso horário do workspace.');}
  const period=(await c.query(`WITH local_day AS(SELECT (clock_timestamp() AT TIME ZONE $1)::date AS today)
   SELECT today::text AS today,(today-($2::int-1))::timestamp AT TIME ZONE $1 AS from_at,(today+1)::timestamp AT TIME ZONE $1 AS to_at FROM local_day`,[queryZone,options.days])).rows[0];
  const rows=(await c.query(`WITH scoped AS(
   SELECT m.*,m.metric_at AT TIME ZONE $1 AS happened,
    o.accepted_at IS NOT NULL AS sent, m.direction='inbound' AND (m.channel='WHATSAPP' OR em.classification='human') AS reply
   FROM app.channel_message m LEFT JOIN app.message_outbox o ON o.workspace_id=m.workspace_id AND o.message_id=m.id
   LEFT JOIN app.email_message em ON em.workspace_id=m.workspace_id AND em.message_id=m.id
   WHERE m.workspace_id=$3 AND m.metric_at>=$4 AND m.metric_at<$5
   AND ($2::text IS NULL OR EXISTS(SELECT 1 FROM app.channel_message related JOIN app.message_outbox ro ON ro.workspace_id=related.workspace_id AND ro.message_id=related.id JOIN app.cadence_publication cp ON cp.workspace_id=ro.workspace_id AND cp.id=ro.publication_id WHERE related.workspace_id=m.workspace_id AND related.conversation_id=m.conversation_id AND cp.cadence_id=$2))
  ) SELECT happened::date::text AS date,count(*) FILTER(WHERE sent AND channel='EMAIL')::int AS email,
   count(*) FILTER(WHERE sent AND channel='WHATSAPP')::int AS whatsapp,count(*) FILTER(WHERE reply)::int AS replies,
   count(*) FILTER(WHERE state='failed')::int AS failed,count(*) FILTER(WHERE state IN('pending','dispatching'))::int AS pending
   FROM scoped GROUP BY happened::date ORDER BY happened::date`,[queryZone,options.cadenceId??null,p.workspaceId,period.from_at,period.to_at])).rows;
  const today=period.today;
  const total={email:0,whatsapp:0,replies:0,failed:0,pending:0};for(const row of rows)for(const key of Object.keys(total) as (keyof typeof total)[])total[key]+=row[key];
  const current=rows.find(row=>row.date===today)??{email:0,whatsapp:0,replies:0,failed:0,pending:0};
  const counts=(await c.query(`SELECT
   (SELECT count(DISTINCT identity_id)::int FROM app.contact_suppression WHERE workspace_id=$1 AND created_at>=$2 AND created_at<$3) AS optouts,
   (SELECT count(*)::int FROM app.email_bounce WHERE workspace_id=$1 AND created_at>=$2 AND created_at<$3) AS bounces`,[p.workspaceId,period.from_at,period.to_at])).rows[0];
  return {...total,period:{timezone,from:period.from_at.toISOString(),to:period.to_at.toISOString()},sent:total.email+total.whatsapp,optouts:options.cadenceId?0:counts.optouts,bounces:options.cadenceId?0:counts.bounces,today:{email:current.email,whatsapp:current.whatsapp,replies:current.replies,failed:current.failed,pending:current.pending},series:rows.map(row=>({date:row.date,sent:row.email+row.whatsapp,replies:row.replies})),tracking:{opens:null,clicks:null}};
 });
}
