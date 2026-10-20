"use client";
import Link from "next/link";
import { useState } from "react";
import { useDemo } from "@/demo/provider";
import { calculateMetrics } from "@/domain/metrics";
import { Icon } from "@/components/ui/icon";
import {
  PageHeader,
  EmptyState,
  Badge,
  LinkButton,
} from "@/components/ui/primitives";
import { PeriodSelector } from "@/components/ui/period-selector";
import { LineChart } from "@/components/charts/line-chart";
export function Reports({ tab = "overview" }: { tab?: string }) {
  const s = useDemo();
  const m = calculateMetrics(s);
  const [period, setPeriod] = useState("30 dias");
  const [cadence, setCadence] = useState("");
  return (
    <>
      <PageHeader
        title="Relatórios"
        description="Desempenho dos disparos e do funil de vendas"
        actions={<PeriodSelector value={period} onChange={setPeriod} />}
      />
      <select
        aria-label="Cadência"
        className="report-cadence-select"
        value={cadence}
        onChange={(e) => setCadence(e.target.value)}
      >
        <option value="">Todas as cadências</option>
        {s.cadences.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <nav className="tabs">
        {[
          ["overview", "Visão geral", "/reports"],
          ["funnel", "Funil de vendas", "/reports/funnel"],
          ["negocios", "Negócios CRM", "/reports/negocios"],
          ["performance", "Performance", "/reports/performance"],
        ].map(([key, label, href]) => (
          <Link
            className={tab === key ? "report-tab active" : "report-tab"}
            href={href}
            key={key}
          >
            {label}
          </Link>
        ))}
      </nav>
      {tab === "overview" || tab === "performance" ? (
        <>
          <div className="report-stats">
            {[
              ["Mail", "E-mails enviados"],
              ["MessageSquare", "WhatsApp enviados"],
              ["Eye", "Aberturas"],
              ["Link2", "Cliques"],
              ["MessageSquare", "Respostas"],
              ["CheckCircle2", "Conexões"],
              ["XCircle", "Bounces"],
              ["LogOut", "Opt-outs"],
            ].map(([icon, name]) => (
              <section className="panel panel-pad" key={name}>
                <div className="row between">
                  <small>{name}</small>
                  <Icon name={icon} size={15} className="orange" />
                </div>
                <strong>0</strong>
                <small>sem execução real</small>
              </section>
            ))}
          </div>
          <div className="reports-grid">
            {[
              "Envios por dia",
              "Engajamento por dia",
              "Conexões & Respostas por dia",
              "Bounces & Opt-outs por dia",
            ].map((title) => (
              <section className="panel panel-pad" key={title}>
                <h3>{title}</h3>
                <div className="chart-legend">
                  <span className="dot orange" /> {period} · nenhuma mensagem
                  enviada
                </div>
                <LineChart empty values={[0, 0, 0, 0, 0, 0, 0]} />
              </section>
            ))}
          </div>
        </>
      ) : tab === "funnel" ? (
        <section className="panel panel-pad">
          <h2>Funil de qualificação</h2>
          <div className="funnel-bars">
            {[
              ["Leads na base", m.total],
              ["Qualificados", m.qualified],
              ["Mensagens enviadas", 0],
              ["Respostas", 0],
              ["Conexões", 0],
            ].map(([label, n]) => (
              <div key={String(label)}>
                <div className="row between">
                  <span>{label}</span>
                  <strong>{n}</strong>
                </div>
                <div className="funnel-track">
                  <i
                    style={{
                      width: `${m.total ? (Number(n) / m.total) * 100 : 0}%`,
                      background: "var(--primary)",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="panel">
          <EmptyState
            icon="Workflow"
            title="Nenhum negócio sincronizado"
            description="Conecte seu CRM para acompanhar negócios gerados pela prospecção."
          >
            <LinkButton href="/settings/apps">Ver integrações</LinkButton>
          </EmptyState>
        </section>
      )}
    </>
  );
}
export function Executions() {
  const s = useDemo();
  const [filter, setFilter] = useState("");
  const jobs = s.jobs.filter((j) => !filter || j.type === filter);
  return (
    <>
      <PageHeader
        title="Execuções"
        description="Acompanhe o histórico de geração, qualificação e automações."
      />
      <select
        className="report-cadence-select"
        aria-label="Tipo de execução"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      >
        <option value="">Todas as execuções</option>
        <option value="generation">Geração</option>
        <option value="qualification">Qualificação</option>
        <option value="enrichment">Enriquecimento</option>
      </select>
      <section className="panel section-gap">
        {jobs.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>EXECUÇÃO</th>
                  <th>TIPO</th>
                  <th>RESULTADO</th>
                  <th>LEADS</th>
                  <th>DATA</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>
                      {j.name}
                      <small>{j.details}</small>
                    </td>
                    <td>
                      <Badge>Demonstração local</Badge>
                    </td>
                    <td>
                      <Badge tone="green">Concluída</Badge>
                    </td>
                    <td>{j.count}</td>
                    <td>{new Date(j.createdAt).toLocaleString("pt-BR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="Clock"
            title="Nenhuma execução encontrada"
            description="As simulações locais aparecem aqui. Ainda não há serviços externos conectados."
          />
        )}
      </section>
    </>
  );
}
