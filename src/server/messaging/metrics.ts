import type {Principal} from '../../domain/workspace.ts';
import type {MessageMetrics} from '../../domain/message-metrics.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
export async function readMessageMetrics(p:Principal,options:{days:number;cadenceId?:string}):Promise<MessageMetrics>{
 if(!Number.isInteger(options.days)||options.days<1||options.days>90||options.cadenceId&&options.cadenceId.length>200)throw new AppError(422,'Período inválido.');
 return withWorkspaceTransaction(p,async c=>{
  const timezone=(await c.query("SELECT coalesce(payload->>'timezone','America/Sao_Paulo') AS zone FROM app.workspace_preferences")).rows[0]?.zone??'America/Sao_Paulo';
  const rows=(await c.query(`WITH bounds AS(SELECT (clock_timestamp() AT TIME ZONE $1)::date AS today), scoped AS(
   SELECT m.*,coalesce(m.accepted_at,m.occurred_at,m.created_at) AT TIME ZONE $1 AS happened,
    o.accepted_at IS NOT NULL AS sent, m.direction='inbound' AND (m.channel='WHATSAPP' OR em.classification='human') AS reply
   FROM app.channel_message m LEFT JOIN app.message_outbox o ON o.workspace_id=m.workspace_id AND o.message_id=m.id
   LEFT JOIN app.email_message em ON em.workspace_id=m.workspace_id AND em.message_id=m.id
   WHERE ($3::text IS NULL OR EXISTS(SELECT 1 FROM app.channel_message related JOIN app.message_outbox ro ON ro.workspace_id=related.workspace_id AND ro.message_id=related.id JOIN app.cadence_publication cp ON cp.workspace_id=ro.workspace_id AND cp.id=ro.publication_id WHERE related.workspace_id=m.workspace_id AND related.conversation_id=m.conversation_id AND cp.cadence_id=$3))
  ) SELECT happened::date::text AS date,count(*) FILTER(WHERE sent AND channel='EMAIL')::int AS email,
   count(*) FILTER(WHERE sent AND channel='WHATSAPP')::int AS whatsapp,count(*) FILTER(WHERE reply)::int AS replies,
   count(*) FILTER(WHERE state='failed')::int AS failed,count(*) FILTER(WHERE state IN('pending','dispatching'))::int AS pending
   FROM scoped,bounds WHERE happened::date BETWEEN today-($2::int-1) AND today GROUP BY happened::date ORDER BY happened::date`,[timezone,options.days,options.cadenceId??null])).rows;
  const today=(await c.query('SELECT (clock_timestamp() AT TIME ZONE $1)::date::text AS day',[timezone])).rows[0].day;
  const total={email:0,whatsapp:0,replies:0,failed:0,pending:0};for(const row of rows)for(const key of Object.keys(total) as (keyof typeof total)[])total[key]+=row[key];
  const current=rows.find(row=>row.date===today)??{email:0,whatsapp:0,replies:0,failed:0,pending:0};
  const counts=(await c.query(`SELECT
   (SELECT count(DISTINCT identity_id)::int FROM app.contact_suppression WHERE created_at>=((clock_timestamp() AT TIME ZONE $1)::date-($2::int-1)) AT TIME ZONE $1) AS optouts,
   (SELECT count(*)::int FROM app.email_bounce WHERE created_at>=((clock_timestamp() AT TIME ZONE $1)::date-($2::int-1)) AT TIME ZONE $1) AS bounces`,[timezone,options.days])).rows[0];
  return {...total,sent:total.email+total.whatsapp,optouts:options.cadenceId?0:counts.optouts,bounces:options.cadenceId?0:counts.bounces,today:{email:current.email,whatsapp:current.whatsapp,replies:current.replies,failed:current.failed,pending:current.pending},series:rows.map(row=>({date:row.date,sent:row.email+row.whatsapp,replies:row.replies})),tracking:{opens:null,clicks:null}};
 });
}
