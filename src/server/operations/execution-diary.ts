import {z} from 'zod';
import {executionStatuses,type ExecutionDiaryPage} from '../../domain/execution-diary.ts';
import {requirePrincipal} from '../auth/principal.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError,errorResponse} from '../errors.ts';
import {authorizeReport} from './projections.ts';

const filters = z.strictObject({
  q: z.string().trim().max(120).default(''),
  period: z.enum(['all','today','7','30']).default('all'),
  status: z.enum(['all',...executionStatuses]).default('all'),
  channel: z.enum(['all','EMAIL','WHATSAPP','LINKEDIN']).default('all'),
  detail: z.enum(['essential','trace']).default('essential'),
  size: z.enum(['25','50','100']).default('50').transform(Number),
  page: z.string().regex(/^[1-9][0-9]{0,8}$/).default('1').transform(Number),
});

const skippedReasons = {
  REPLY:'O contato já respondeu.',
  OPTOUT:'O contato pediu para sair da cadência.',
  REPLY_OR_OPTOUT:'O contato respondeu ou pediu para sair da cadência.',
  CONTACT_SUPPRESSED:'O contato está bloqueado para envio.',
};

const delayReasons = {
  DAILY_LIMIT:'Limite diário atingido. O envio foi adiado.',
  EMAIL_DAILY_LIMIT:'Limite diário de e-mail atingido. O envio foi adiado.',
  OPENWA_DAILY_LIMIT:'Limite diário do WhatsApp atingido. O envio foi adiado.',
  OPENWA_NEW_CONVERSATION_LIMIT:'Limite de novas conversas do WhatsApp atingido. O envio foi adiado.',
  OPENWA_REPLY_LIMIT:'Limite diário de respostas do WhatsApp atingido. A resposta foi adiada.',
  OPENWA_PACING:'Aguardando o intervalo entre envios do WhatsApp, para não parecer disparo em massa.',
  OPENWA_LOW_REPLY_RATE:'Poucos contatos responderam nos últimos 7 dias. Os envios ativos do WhatsApp foram adiados para proteger o número.',
  SENDER_INTERVAL:'Aguardando o intervalo entre envios.',
};

export async function executionDiaryRequest(request:Request) {
  try {
    const principal = await requirePrincipal(request.headers);
    const expected = request.headers.get('x-cadence-workspace');
    if (expected && expected !== principal.workspaceId) throw new AppError(409,'O workspace mudou. Atualize o diário.','WORKSPACE_CHANGED');
    const entries = [...new URL(request.url).searchParams];
    const parsed = filters.safeParse(Object.fromEntries(entries));
    if (!parsed.success || new Set(entries.map(([key])=>key)).size !== entries.length) throw new AppError(422,'Filtros de execuções inválidos.');
    const {q,period,status,channel,detail,size,page} = parsed.data;
    const result = await withWorkspaceTransaction(principal, async c => {
      await authorizeReport(c,principal);
      const {rows:[row]} = await c.query<ExecutionDiaryPage>(`
        WITH prefs AS (
          SELECT coalesce((SELECT payload->>'timezone' FROM app.workspace_preferences WHERE workspace_id=$1),'America/Sao_Paulo') AS zone
        ), messages AS MATERIALIZED (
          SELECT o.message_id id, o.workspace_id, m.channel, m.state, o.state AS outbox_state,
            o.blocked_code, bounce.kind AS bounce,
            coalesce(bounce.created_at,m.accepted_at,o.accepted_at,m.created_at) AS at,
            l.id AS lead_id, l.payload->>'name' AS lead, p.cadence_id,
            coalesce(c.payload->>'name',p.snapshot->'cadence'->>'name') AS cadence
          FROM app.message_outbox o
          JOIN app.channel_message m ON m.workspace_id=o.workspace_id AND m.id=o.message_id
          JOIN app.cadence_publication p ON p.workspace_id=o.workspace_id AND p.id=o.publication_id
          JOIN app.cadence c ON c.workspace_id=p.workspace_id AND c.id=p.cadence_id
          LEFT JOIN app.cadence_enrollment e ON e.workspace_id=o.workspace_id AND e.id=o.enrollment_id
          LEFT JOIN app.lead l ON l.workspace_id=e.workspace_id AND l.id=e.lead_id
          LEFT JOIN LATERAL (
            SELECT b.kind,b.created_at FROM app.email_bounce b
            WHERE m.channel='EMAIL' AND b.workspace_id=m.workspace_id AND b.outbound_message_id=m.id
            ORDER BY (b.kind='hard-bounce') DESC,b.created_at DESC LIMIT 1
          ) bounce ON true
          WHERE o.workspace_id=$1 AND m.direction='outbound' AND ($4='all' OR m.channel=$4)
        ), events AS (
          SELECT id, at, channel, lead_id, lead, cadence_id, cadence, false AS trace,
            CASE
              WHEN bounce IS NOT NULL OR state='failed' OR outbox_state IN ('failed','uncertain') OR state='uncertain' THEN 'error'
              WHEN state IN ('accepted','delivered','read') OR outbox_state='accepted' THEN 'success'
              WHEN outbox_state='cancelled' OR (outbox_state='blocked' AND $8::jsonb ? blocked_code) THEN 'skipped'
              WHEN outbox_state='blocked' THEN 'error'
              ELSE 'progress'
            END AS status,
            CASE
              WHEN bounce='hard-bounce' THEN 'E-mail devolvido. A caixa de destino recusou a mensagem.'
              WHEN bounce='soft-bounce' THEN 'E-mail devolvido temporariamente pela caixa de destino.'
              WHEN state='failed' OR outbox_state='failed' THEN 'Falha no envio.'
              WHEN state='uncertain' OR outbox_state='uncertain' THEN 'Envio sem confirmação. Aguardando conciliação.'
              WHEN state='read' THEN 'Mensagem lida.'
              WHEN state='delivered' THEN 'Mensagem entregue.'
              WHEN state='accepted' OR outbox_state='accepted' THEN 'Mensagem aceita pelo provedor.'
              WHEN outbox_state IN ('cancelled','blocked') AND $8::jsonb ? blocked_code THEN $8::jsonb->>blocked_code
              WHEN outbox_state='cancelled' THEN 'Envio cancelado.'
              WHEN outbox_state='blocked' THEN 'Envio bloqueado. Revise a configuração da cadência ou do canal.'
              WHEN outbox_state='dispatching' THEN 'Enviando mensagem.'
              WHEN outbox_state='pending' AND $10::jsonb ? blocked_code THEN $10::jsonb->>blocked_code
              ELSE 'Aguardando a vez de enviar.'
            END AS event
          FROM messages
          UNION ALL
          SELECT a.id, coalesce(a.completed_at,a.started_at,a.created_at), m.channel,
            m.lead_id, m.lead, m.cadence_id, m.cadence, true,
            CASE a.state WHEN 'accepted' THEN 'success' WHEN 'not_accepted' THEN 'error' WHEN 'uncertain' THEN 'error' ELSE 'progress' END,
            'Tentativa '||a.attempt_number||': '||CASE a.state
              WHEN 'accepted' THEN 'aceita pelo provedor' WHEN 'not_accepted' THEN 'recusada pelo provedor'
              WHEN 'uncertain' THEN 'sem confirmação' WHEN 'dispatching' THEN 'em envio' ELSE 'preparada' END
          FROM messages m
          JOIN app.message_dispatch_attempt a ON a.workspace_id=m.workspace_id AND a.message_id=m.id
          WHERE $5::boolean
        ), matching AS (
          SELECT events.* FROM events CROSS JOIN prefs
          WHERE ($3::int IS NULL OR
            at >= ((now() AT TIME ZONE zone)::date - $3::int)::timestamp AT TIME ZONE zone AND
            at < ((now() AT TIME ZONE zone)::date + 1)::timestamp AT TIME ZONE zone)
            AND ($2='' OR strpos(lower(concat_ws(' ',lead,cadence,event)),$2)>0)
        ), summary AS (
          SELECT jsonb_build_object(
            'success',count(*) FILTER (WHERE NOT trace AND status='success'),
            'error',count(*) FILTER (WHERE NOT trace AND status='error'),
            'skipped',count(*) FILTER (WHERE NOT trace AND status='skipped'),
            'progress',count(*) FILTER (WHERE NOT trace AND status='progress')
          ) counts, count(*) FILTER (WHERE $6='all' OR status=$6)::int total
          FROM matching
        ), current_page AS (
          SELECT least($9::int,greatest(1,ceil(total::numeric/$7::int)::int)) AS page FROM summary
        )
        SELECT counts, total, page, zone AS timezone,
          coalesce((SELECT jsonb_agg(jsonb_build_object(
            'id',id,'at',at,'status',status,'event',event,'leadId',lead_id,'lead',lead,
            'cadenceId',cadence_id,'cadence',cadence,'channel',channel,'trace',trace
          ) ORDER BY at DESC,trace,id DESC) FROM (
            SELECT * FROM matching WHERE $6='all' OR status=$6
            ORDER BY at DESC,trace,id DESC LIMIT $7 OFFSET ((SELECT page FROM current_page)-1)::bigint*$7
          ) items),'[]') items
        FROM summary CROSS JOIN current_page CROSS JOIN prefs
      `,[principal.workspaceId,q.toLowerCase(),period==='all'?null:period==='today'?0:Number(period)-1,channel,detail==='trace',status,size,skippedReasons,page,delayReasons]);
      return row;
    });
    return Response.json(result,{headers:{'cache-control':'no-store'}});
  } catch (error) {
    return errorResponse(error);
  }
}
