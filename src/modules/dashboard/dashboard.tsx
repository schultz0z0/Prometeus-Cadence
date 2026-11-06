"use client";
import Link from "next/link";
import { useState } from "react";
import { useDemo, useNotify } from "@/demo/provider";
import type {ReportMetric} from "@/domain/reporting";
import {ReportDetail,ReportStamp} from "@/components/reports/report-detail";
import { Icon } from "@/components/ui/icon";
import {
  Badge,
  IconButton,
  PageHeader,
} from "@/components/ui/primitives";
import { PeriodSelector } from "@/components/ui/period-selector";
import { LineChart } from "@/components/charts/line-chart";
import { DashboardOnboarding } from "@/components/onboarding/checklist";
import {useReconciledReport} from '@/client/use-reconciled-report';
import {jobStateLabels} from '@/modules/prospecting/job-history';
export function Dashboard() {
  const state = useDemo();
  const notify = useNotify();

  const [period, setPeriod] = useState("30 dias");
  const {report,query,error,refresh:refreshPeriod}=useReconciledReport(period),{report:today,error:todayError,refresh:refreshToday}=useReconciledReport('Hoje');
  const refresh=()=>Promise.all([refreshPeriod(),refreshToday()]);
  const messages=report?.totals,now=today?.totals;
  const [detail,setDetail]=useState<ReportMetric|null>(null);
  const metric=(value:number|null|undefined)=>value==null?(report?'—':'…'):value.toLocaleString('pt-BR');
  const m={total:messages?.leads??0,qualified:messages?.qualified??0,funnel:{qualified:messages?.qualified??0,pending:(messages?.leadPending??0)+(messages?.leadWarning??0),disqualified:messages?.leadDisqualified??0}};
  const stats = [
    ["Leads novos", metric(messages?.leads), "criados no período", "Users", "orange"],
    [
      "Qualificados",
      metric(messages?.qualified),
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
                void refresh().then(()=>notify("Indicadores atualizados com os registros operacionais.")).catch(e=>notify(e.message))
              }
            />
          </>
        }
      />

      <div className="stats-grid">
        {stats.map(([label, value, sub, icon, color]) => (
          <div key={label} className="stat-card panel">
            <div className="between row">
              <span>{label}</span>
              <Icon name={icon} size={16} className={color} />
            </div>
            {query&&label!=="Abertura de e-mail"?<button className="report-metric-value" aria-label={'Ver registros de '+label} onClick={()=>setDetail(({"Leads novos":"leads","Qualificados":"qualified","Mensagens aceitas":"sent","Respostas":"replies","Opt-outs":"optouts"} as Record<string,ReportMetric>)[label])}><strong>{value}</strong></button>:<strong>{value}</strong>}<small>{sub}</small>
          </div>
        ))}
      </div>
      <section className="panel today-panel">
        {todayError&&<p role="alert">Indicadores de hoje: {todayError}</p>}
        <div className="row between">
          <h3 className="row">
            <Icon name="Sun" size={17} className="orange" />
            Hoje
          </h3>
          <small>desde 00:00 · {state.preferences.timezone}</small>
        </div>
        <div className="today-grid">
          {[
            ["Na fila", "Calendar", metric(now?.pending), "mensagens criadas hoje"],
            ["E-mails", "Mail", metric(now?.email), "aceitos"],
            ["WhatsApp", "MessageSquare", metric(now?.whatsapp), "aceitos"],
            ["Respostas", "MessageSquare", metric(now?.replies), ""],
            ["Erros", "XCircle", metric(now?.failed), ""],
            ["Cadências", "Send", metric(messages?.cadences), "no workspace"],
            [
              "Automações",
              "Workflow",
              metric(messages?.automations),
              "configuradas no workspace",
            ],
            ["Leads", "Users", metric(messages?.baseLeads), "no workspace"],
            [
              "Qualificados",
              "CheckCircle2",
              metric(messages?.baseQualified),
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
            <small>{period.includes("/")?"Período personalizado":period} · criados no período</small>
          </div>
          <LineChart values={report?.series.map(day=>day.values.leads??0)??[]} dates={report?.series.map(day=>day.date)}/>
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
          <small>execuções criadas no período</small>
          <div className="mini-stats">
            <div>
              <strong>{metric(messages?.executionInserted)}</strong>
              <small>SALVOS</small>
            </div>
            <div>
              <strong>{metric(messages?.executions)}</strong>
              <small>EXECUÇÕES</small>
            </div>
            <div>
              <strong>{metric(messages?.commercialCredits)}</strong>
              <small>CRÉDITOS USADOS</small>
            </div>
          </div>
          <p className="muted">Resultados persistidos das execuções. O consumo comercial consolidado não é medido neste relatório.</p>
        </section>
        <section className="panel panel-pad">
          <h3>Leads nas cadências</h3>
          <small>publicações criadas no período</small>
          <div className="funnel-bars">
            <div className="row between">
              <span>Leads inscritos</span>
              <strong>{metric(messages?.enrolled)}</strong>
            </div>
            <div className="funnel-track">
              <i style={{ width: "100%", background: "var(--primary)" }} />
            </div>
          </div>
          <p className="muted">{metric(messages?.activeCadences)} cadências ativas · histórico em Execuções</p>
          <Link className="orange small-link" href="/cadences">
            Ver cadências →
          </Link>
        </section>
      </div>
      <section className="panel section-gap">
        <div className="panel-heading">
          <h3>Atividade recente</h3>
          <Link className="small-link" href="/executions?view=jobs">
            Ver todas →
          </Link>
        </div>
        <div className="activity-empty">
          {report?.recentExecutions.length ? (
            report.recentExecutions.map(j=>(<div className="row" key={j.id}><Icon name="Clock"/><Link href={'/executions/'+j.id}>{{generation:'Busca de empresas',qualification:'Qualificação',planning:'Análise de IA'}[j.kind]??'Execução'} · {j.counts.inserted??0} resultados salvos</Link><Badge>{jobStateLabels[j.state]??j.state}</Badge></div>))
          ) : (
            <>
              <Icon name="Clock" size={25} />
              <p>Nenhuma execução encontrada</p>
              <small>Configure suas cadências para começar</small>
            </>
          )}
        </div>
      </section>
      <ReportStamp report={report} error={error} onRefresh={refresh}/>
      {detail&&query&&<ReportDetail key={detail+JSON.stringify(query)} metric={detail} query={query} onClose={()=>setDetail(null)}/>}
    </div>
  );
}
