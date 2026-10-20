"use client";
import Link from "next/link";
import { useState } from "react";
import { useDemo, useRepository, useNotify } from "@/demo/provider";
import { calculateMetrics } from "@/domain/metrics";
import { Icon } from "@/components/ui/icon";
import { Badge, Button, IconButton, LinkButton, PageHeader, } from "@/components/ui/primitives";
import { PeriodSelector } from "@/components/ui/period-selector";
import { LineChart } from "@/components/charts/line-chart";
import { Tour } from "@/components/onboarding/tour";
export function Dashboard() {
    const state = useDemo();
    const repo = useRepository();
    const notify = useNotify();
    const m = calculateMetrics(state);
    const [period, setPeriod] = useState("30 dias");
    const [tour, setTour] = useState(false);
    const list = state.lists[0];
    const stats = [
        ["Leads novos", String(m.total), "base: " + m.total, "Users", "orange"],
        [
            "Qualificados",
            String(m.qualified),
            `${m.total ? Math.round((m.qualified / m.total) * 100) : 0}% dos novos`,
            "CheckCircle2",
            "green-text",
        ],
        ["Mensagens enviadas", "0", "0 e-mail · 0 WhatsApp", "Send", "orange"],
        ["Respostas", "0", "0% dos envios", "MessageSquare", "green-text"],
        ["Abertura de e-mail", "0%", "0% clicaram", "Eye", "purple-text"],
        ["Opt-outs", "0", "no período", "XCircle", "orange"],
    ];
    return (<>
      <PageHeader title="Dashboard" description="Visão geral da sua prospecção" actions={<>
            <PeriodSelector value={period} onChange={setPeriod}/>
            <IconButton icon="RefreshCw" label="Atualizar" onClick={() => notify("Indicadores atualizados com a base local.")}/>
          </>}/>
      {!state.preferences.onboardingHidden && (<section className="panel setup-panel">
          <div className="setup-heading">
            <div>
              <h3>Sua prospecção está montada. Falta ligar.</h3>
              <div className="created-chips">
                <span>Criado:</span>
                <Badge>
                  <Icon name="Users" size={12}/>
                  {list?.name ?? "Sua primeira lista"} · {m.total}
                </Badge>
                <Link href="/cadences">
                  <Badge>
                    <Icon name="Workflow" size={12}/>
                    cadência
                  </Badge>
                </Link>
                <Link href="/automations">
                  <Badge>
                    <Icon name="Bot" size={12}/>
                    {state.automations.length} automações · prontas
                  </Badge>
                </Link>
              </div>
            </div>
            <div className="row">
              <Button icon="Compass" onClick={() => setTour(true)}>
                Como tudo se liga
              </Button>
              <button className="text-button muted" onClick={async () => await repo.updatePreferences({ onboardingHidden: true })}>
                Fechar
              </button>
            </div>
          </div>
          <div className="setup-body">
            <div className="setup-steps">
              <div className="setup-step">
                <span className="number-circle">1</span>
                <div className="grow">
                  <strong>Revisar o contexto da empresa</strong>
                  <p>
                    Confira o que você vende e para quem. É o que orienta suas
                    mensagens.
                  </p>
                </div>
                <LinkButton href="/settings/context" variant="primary">
                  Revisar contexto
                </LinkButton>
              </div>
              <div className="setup-step">
                <span className="number-circle">2</span>
                <div className="grow">
                  <strong>Conectar o WhatsApp</strong>
                  <p>
                    Os canais serão conectados na próxima etapa de integração.
                  </p>
                  <p className="spaced-note">
                    Depois, conecte também{" "}
                    <Link href="/settings/email">e-mail</Link> e{" "}
                    <Link href="/linkedin/dashboard">LinkedIn</Link>: a mesma
                    cadência vira multicanal, sem refazer nada.
                  </p>
                </div>
              </div>
              <div className="setup-step">
                <span className="number-circle inactive">3</span>
                <div className="grow">
                  <strong>Ligar a cadência</strong>
                  <p>
                    A primeira mensagem sai no próximo horário de envio. Para
                    sozinha pra quem responder.
                  </p>
                </div>
                <LinkButton href="/cadences/cadence-initial" icon="Eye">
                  Ver como chega
                </LinkButton>
              </div>
            </div>
            <div className="setup-side">
              <small>PRIMEIROS PASSOS · 3 DE 6</small>
              <div className="progress-track">
                <i style={{ width: "50%" }}/>
              </div>
              <Link href="/first-steps">
                <Icon name="Compass" size={15}/> Continue de onde parou{" "}
                <Icon name="ArrowRight" size={13}/>
              </Link>
            </div>
          </div>
        </section>)}
      <div className="stats-grid">
        {stats.map(([label, value, sub, icon, color]) => (<div key={label} className="stat-card panel">
            <div className="between row">
              <span>{label}</span>
              <Icon name={icon} size={16} className={color}/>
            </div>
            <strong>{value}</strong>
            <small>{sub}</small>
          </div>))}
      </div>
      <section className="panel today-panel">
        <div className="row between">
          <h3 className="row">
            <Icon name="Sun" size={17} className="orange"/>
            Hoje
          </h3>
          <small>desde 00:00 · {state.preferences.timezone}</small>
        </div>
        <div className="today-grid">
          {[
            ["Previsto", "Calendar", "0", "nada previsto"],
            ["E-mails", "Mail", "0", ""],
            ["WhatsApp", "MessageSquare", "0", ""],
            ["Respostas", "MessageSquare", "0", ""],
            ["Erros", "XCircle", "0", ""],
            ["Cadências", "Send", "0", "que enviaram"],
            [
                "Automações",
                "Workflow",
                String(state.jobs.length),
                "simulações locais",
            ],
            ["Leads", "Users", String(m.total), "na demonstração"],
            [
                "Qualificados",
                "CheckCircle2",
                String(m.qualified),
                "na demonstração",
            ],
        ].map(([name, icon, num, help]) => (<div className="today-item" key={name}>
              <span>
                <Icon name={icon} size={13}/>
                {name}
              </span>
              <strong>{num}</strong>
              <small>{help || "\u00a0"}</small>
            </div>))}
        </div>
      </section>
      <div className="dashboard-grid">
        <section className="panel panel-pad">
          <div className="row between">
            <h3 className="row">
              <Icon name="ChartNoAxesColumn" size={17} className="orange"/>
              Leads novos por dia
            </h3>
            <small>{period} · base demonstrativa</small>
          </div>
          <LineChart values={[0, 0, 0, 0, 0, 0, 0, 0, 0, m.total]}/>
        </section>
        <section className="panel panel-pad">
          <h3 className="row">
            <Icon name="Target" size={17} className="orange"/>
            Funil de qualificação
          </h3>
          <div className="funnel-bars">
            {([
            ["qualified", "Qualificado", "var(--green)"],
            ["pending", "Pendente", "#94a3b8"],
            ["disqualified", "Desqualificado", "#f87171"],
        ] as const).map(([key, label, color]) => (<div key={key}>
                <div className="row between">
                  <span>{label}</span>
                  <small>
                    {m.funnel[key]} (
                    {m.total ? Math.round((m.funnel[key] / m.total) * 100) : 0}
                    %)
                  </small>
                </div>
                <div className="funnel-track">
                  <i style={{
                width: `${m.total ? (m.funnel[key] / m.total) * 100 : 0}%`,
                background: color,
            }}/>
                </div>
              </div>))}
          </div>
        </section>
      </div>
      <div className="dashboard-grid thirds">
        <section className="panel panel-pad">
          <h3>Prospecção</h3>
          <small>no período</small>
          <div className="metric-list">
            {[
            "E-mails",
            "WhatsApp",
            "Respostas",
            "Conexões",
            "Aberturas",
            "Cliques",
            "Opt-out",
        ].map((x) => (<div key={x}>
                <span>{x}</span>
                <strong>0</strong>
              </div>))}
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
              <strong>0</strong>
              <small>CRÉDITOS USADOS</small>
            </div>
          </div>
          <p className="muted">Nenhuma integração externa executada.</p>
        </section>
        <section className="panel panel-pad">
          <h3>Leads nas cadências</h3>
          <small>na base demonstrativa</small>
          <div className="funnel-bars">
            <div className="row between">
              <span>Aguardando início</span>
              <strong>{m.qualified}</strong>
            </div>
            <div className="funnel-track">
              <i style={{ width: "100%", background: "var(--primary)" }}/>
            </div>
          </div>
          <p className="muted">0 cadências ativas · 0 rodaram hoje</p>
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
          {state.jobs.length ? (state.jobs.slice(0, 3).map((j) => (<div className="row" key={j.id}>
                <Icon name="CheckCircle2" className="green-text"/>
                <span>
                  {j.name} · {j.count} leads
                </span>
                <Badge>Demonstração</Badge>
              </div>))) : (<>
              <Icon name="Clock" size={25}/>
              <p>Nenhuma execução encontrada</p>
              <small>Configure suas cadências para começar</small>
            </>)}
        </div>
      </section>
      {tour && <Tour onClose={() => setTour(false)}/>}
    </>);
}
