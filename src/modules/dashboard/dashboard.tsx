"use client";
import Link from "next/link";
import { useState } from "react";
import { useDemo, useNotify } from "@/demo/provider";
import { calculateMetrics } from "@/domain/metrics";
import { Icon } from "@/components/ui/icon";
import {
  Badge,
  IconButton,
  PageHeader,
} from "@/components/ui/primitives";
import { PeriodSelector } from "@/components/ui/period-selector";
import { LineChart } from "@/components/charts/line-chart";
import { DashboardOnboarding } from "@/components/onboarding/checklist";
import {useMessageMetrics} from '@/client/use-message-metrics';
import {useWorkspaceRefresh} from '@/client/workspace-provider';
function dailyLeadCounts(leads: { createdAt: string }[], days: number, timezone: string) {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const counts = new Map<string, number>();
  for (let offset = days - 1; offset >= 0; offset--) counts.set(format.format(new Date(Date.now() - offset * 86_400_000)), 0);
  for (const lead of leads) {
    const date = new Date(lead.createdAt);
    if (!Number.isFinite(date.getTime())) continue;
    const day = format.format(date);
    if (counts.has(day)) counts.set(day, counts.get(day)! + 1);
  }
  return [...counts.values()];
}
export function Dashboard() {
  const state = useDemo();
  const notify = useNotify();
  const m = calculateMetrics(state);
  const [period, setPeriod] = useState("30 dias");
  const {metrics:messages,error:metricsError,live}=useMessageMetrics(period),refresh=useWorkspaceRefresh();
  const metric=(value:number|undefined)=>value===undefined?(live?'…':'0'):String(value);
  const stats = [
    ["Leads novos", String(m.total), "base: " + m.total, "Users", "orange"],
    [
      "Qualificados",
      String(m.qualified),
      `${m.total ? Math.round((m.qualified / m.total) * 100) : 0}% dos novos`,
      "CheckCircle2",
      "green-text",
    ],
    ["Mensagens aceitas", metric(messages?.sent), metric(messages?.email)+" e-mail · "+metric(messages?.whatsapp)+" WhatsApp", "Send", "orange"],
    ["Respostas", metric(messages?.replies), "recebidas no período", "MessageSquare", "green-text"],
    ["Abertura de e-mail", "—", "Rastreamento indisponível", "Eye", "purple-text"],
    ["Opt-outs", metric(messages?.optouts), "no período", "XCircle", "orange"],
  ];
  return (
    <div className="reference-dashboard">
      <DashboardOnboarding />
      <PageHeader
        title="Dashboard"
        description="Visão geral da sua prospecção"
        actions={
          <>
            <PeriodSelector value={period} onChange={setPeriod} />
            <IconButton
              icon="RefreshCw"
              label="Atualizar"
              onClick={() =>
                void refresh?.().then(()=>notify("Indicadores atualizados com a base do workspace.")).catch(e=>notify(e.message))
              }
            />
          </>
        }
      />
      {metricsError&&<p role="status">Indicadores de mensagens: {metricsError}</p>}
      <div className="stats-grid">
        {stats.map(([label, value, sub, icon, color]) => (
          <div key={label} className="stat-card panel">
            <div className="between row">
              <span>{label}</span>
              <Icon name={icon} size={16} className={color} />
            </div>
            <strong>{value}</strong>
            <small>{sub}</small>
          </div>
        ))}
      </div>
      <section className="panel today-panel">
        <div className="row between">
          <h3 className="row">
            <Icon name="Sun" size={17} className="orange" />
            Hoje
          </h3>
          <small>desde 00:00 · {state.preferences.timezone}</small>
        </div>
        <div className="today-grid">
          {[
            ["Na fila", "Calendar", metric(messages?.today.pending), "mensagens criadas hoje"],
            ["E-mails", "Mail", metric(messages?.today.email), "aceitos"],
            ["WhatsApp", "MessageSquare", metric(messages?.today.whatsapp), "aceitos"],
            ["Respostas", "MessageSquare", metric(messages?.today.replies), ""],
            ["Erros", "XCircle", metric(messages?.today.failed), ""],
            ["Cadências", "Send", String(state.cadences.length), "no workspace"],
            [
              "Automações",
              "Workflow",
              String(state.jobs.length),
              "simulações locais",
            ],
            ["Leads", "Users", String(m.total), "no workspace"],
            [
              "Qualificados",
              "CheckCircle2",
              String(m.qualified),
              "no workspace",
            ],
          ].map(([name, icon, num, help]) => (
            <div className="today-item" key={name}>
              <span>
                <Icon name={icon} size={13} />
                {name}
              </span>
              <strong>{num}</strong>
              <small>{help || "\u00a0"}</small>
            </div>
          ))}
        </div>
      </section>
      <div className="dashboard-grid">
        <section className="panel panel-pad">
          <div className="row between">
            <h3 className="row">
              <Icon name="ChartNoAxesColumn" size={17} className="orange" />
              Leads novos por dia
            </h3>
            <small>{period} · base do workspace</small>
          </div>
          <LineChart values={dailyLeadCounts(state.leads, period === "Hoje" ? 1 : period === "7 dias" ? 7 : period === "90 dias" ? 90 : 30, state.preferences.timezone)} />
        </section>
        <section className="panel panel-pad">
          <h3 className="row">
            <Icon name="Target" size={17} className="orange" />
            Funil de qualificação
          </h3>
          <div className="funnel-bars">
            {(
              [
                ["qualified", "Qualificado", "var(--green)"],
                ["pending", "Pendente", "#94a3b8"],
                ["disqualified", "Desqualificado", "#f87171"],
              ] as const
            ).map(([key, label, color]) => (
              <div key={key}>
                <div className="row between">
                  <span>{label}</span>
                  <small>
                    {m.funnel[key]} (
                    {m.total ? Math.round((m.funnel[key] / m.total) * 100) : 0}
                    %)
                  </small>
                </div>
                <div className="funnel-track">
                  <i
                    style={{
                      width: `${m.total ? (m.funnel[key] / m.total) * 100 : 0}%`,
                      background: color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="dashboard-grid thirds">
        <section className="panel panel-pad">
          <h3>Prospecção</h3>
          <small>no período</small>
          <div className="metric-list">
            {[
              ["E-mails",metric(messages?.email)],
              ["WhatsApp",metric(messages?.whatsapp)],
              ["Respostas",metric(messages?.replies)],
              ["Aberturas","—"],
              ["Cliques","—"],
              ["Opt-out",metric(messages?.optouts)],
            ].map(([name,value]) => (
              <div key={name}>
                <span>{name}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <Link className="orange small-link" href="/reports">
            Ver relatório detalhado →
          </Link>
        </section>
        <section className="panel panel-pad">
          <h3>Geração e qualificação</h3>
          <small>simulações locais</small>
          <div className="mini-stats">
            <div>
              <strong>{state.jobs.reduce((n, j) => n + j.count, 0)}</strong>
              <small>SALVOS</small>
            </div>
            <div>
              <strong>{state.jobs.length}</strong>
              <small>EXECUÇÕES</small>
            </div>
            <div>
              <strong>{state.jobs.reduce((total, job) => total + job.billableUsage, 0)}</strong>
              <small>CRÉDITOS USADOS</small>
            </div>
          </div>
          <p className="muted">Resumo das simulações locais. Consulte Execuções para acompanhar os trabalhos dos provedores.</p>
        </section>
        <section className="panel panel-pad">
          <h3>Leads nas cadências</h3>
          <small>no workspace</small>
          <div className="funnel-bars">
            <div className="row between">
              <span>Qualificados na base</span>
              <strong>{m.qualified}</strong>
            </div>
            <div className="funnel-track">
              <i style={{ width: "100%", background: "var(--primary)" }} />
            </div>
          </div>
          <p className="muted">{state.cadences.filter(cadence => !cadence.archived && cadence.status === "active").length} cadências ativas · histórico em Execuções</p>
          <Link className="orange small-link" href="/cadences">
            Ver cadências →
          </Link>
        </section>
      </div>
      <section className="panel section-gap">
        <div className="panel-heading">
          <h3>Atividade recente</h3>
          <Link className="small-link" href="/executions">
            Ver todas →
          </Link>
        </div>
        <div className="activity-empty">
          {state.jobs.length ? (
            state.jobs.slice(0, 3).map((j) => (
              <div className="row" key={j.id}>
                <Icon name="CheckCircle2" className="green-text" />
                <span>
                  {j.name} · {j.count} leads
                </span>
                <Badge>Demonstração</Badge>
              </div>
            ))
          ) : (
            <>
              <Icon name="Clock" size={25} />
              <p>Nenhuma execução encontrada</p>
              <small>Configure suas cadências para começar</small>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
