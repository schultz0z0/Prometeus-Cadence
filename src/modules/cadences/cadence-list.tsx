"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useMessaging } from "@/client/workspace-provider";
import type { MessageMetrics } from "@/domain/message-metrics";
import type { PublicationView } from "@/domain/cadence-runtime";
import { useRouter } from "next/navigation";
import { useDemo, useRepository, useAction } from "@/demo/provider";
import { buildDemoCadenceOptions } from "@/demo/cadence";
import {
  Badge,
  Button,
  IconButton,
  PageHeader,
  Modal,
  LinkButton,
  EmptyState,
  Notice,
} from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
export function CadenceList() {
  const s = useDemo();
  const repo = useRepository();
  const run = useAction();
  const router = useRouter();
  const messaging=useMessaging(),[metrics,setMetrics]=useState<MessageMetrics|null>(null),[cadenceMetrics,setCadenceMetrics]=useState<Record<string,MessageMetrics>>({}),[publications,setPublications]=useState<PublicationView[]>([]),[metricsError,setMetricsError]=useState('');
  const [period,setPeriod]=useState(30),[order,setOrder]=useState('recent');
  const cadenceIds=s.cadences.map(c=>c.id).join(',');
  useEffect(()=>{let active=true;setMetrics(null);setCadenceMetrics({});setMetricsError('');if(messaging){messaging.metrics(period).then(value=>{if(active)setMetrics(value);}).catch(e=>{if(active)setMetricsError(e.message);});messaging.listPublications().then(value=>{if(active)setPublications(value);}).catch(e=>{if(active)setMetricsError(e.message);});void Promise.allSettled(cadenceIds.split(',').filter(Boolean).map(async id=>({id,metrics:await messaging.metrics(period,id)}))).then(results=>{if(active)setCadenceMetrics(Object.fromEntries(results.flatMap(result=>result.status==='fulfilled'?[[result.value.id,result.value.metrics]]:[])));});}return()=>{active=false;};},[messaging,period,cadenceIds]);
  const [create, setCreate] = useState(false);
  const [mode, setMode] = useState("");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState("Lista");
  const [gate, setGate] = useState(false);
  const [archived, setArchived] = useState(false);
  const list = s.cadences.filter(
    (c) =>
      !!c.archived === archived &&
      (!filter || c.status === filter) &&
      [c.name, s.lists.find((l) => l.id === c.listId)?.name]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  ).toSorted((a,b)=>order==='name'?a.name.localeCompare(b.name):order==='oldest'?a.createdAt.localeCompare(b.createdAt):b.createdAt.localeCompare(a.createdAt));
  async function useModel(index: number) {
    const opts = buildDemoCadenceOptions({
      listId: s.lists[0]?.id ?? "",
      objective: ["Primeiro contato", "Retomar quem sumiu", "Reativar base"][
        index
      ],
      channels: ["WHATSAPP"],
      tone: "Pessoal",
      rhythm: "Padrão",
      highlight: "",
      avoid: "",
      decisionMaker: "",
      profile: s.companyProfile,
    });
    const c = opts[0];
    if (
      await run(
        async () => await repo.saveCadenceDraft(c),
        "Modelo salvo como rascunho.",
      )
    )
      router.push(`/cadences/${c.id}`);
  }
  return (
    <div className="workflow-reference cadence-list-reference">
      <PageHeader
        title="Cadências"
        description={`${s.cadences.filter((c) => !c.archived).length} cadências · ${messaging?publications.filter(p=>p.state==='active').length:s.cadences.filter(c=>c.status==='active').length} ativas`}
        actions={
          <Button variant="primary" icon="Plus" onClick={() => setCreate(true)}>
            Nova cadência
          </Button>
        }
      />
      <section className="panel cadence-today">
        <h3>Hoje</h3>
        {[
          [metrics?String(metrics.today.email+metrics.today.whatsapp):'—', "JÁ SAÍRAM"],
          [metrics?String(metrics.today.pending):'—', "AGUARDANDO HOJE"],
          [metrics?String(metrics.today.replies):'—', "RESPOSTAS HOJE"],
        ].map(([n, t]) => (
          <div key={t}>
            <strong>{n}</strong>
            <small>{t}</small>
          </div>
        ))}
        <button className="orange" onClick={() => setGate(true)}>
          entender por quê
        </button>
      </section>
      {metricsError&&<p role="alert" className="error-bar">Não foi possível atualizar todas as métricas: {metricsError}</p>}
      <div className="contacts-toolbar section-gap">
        <div className="row wrap">
          <input
            className="search-field"
            aria-label="Buscar cadência"
            placeholder="Buscar cadência, lista ou tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="Status das cadências"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">Status: todas</option>
            {[
              ["active", "Ativas"],
              ["paused", "Pausadas"],
              ["draft", "Rascunhos"],
              ["completed", "Concluídas"],
            ].map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))}
          </select>
          <select aria-label="Período das métricas" value={period} onChange={e=>setPeriod(Number(e.target.value))}>{[1,7,30,90].map(days=><option key={days} value={days}>Métricas: {days===1?'hoje':`${days} dias`}</option>)}</select>
          <select aria-label="Ordenar cadências" value={order} onChange={e=>setOrder(e.target.value)}><option value="recent">Mais recentes</option><option value="oldest">Mais antigas</option><option value="name">Nome A–Z</option></select>
          <button
            className={`pill ${archived ? "selected" : ""}`}
            onClick={() => setArchived(!archived)}
          >
            {archived ? "Arquivadas" : "Ver arquivadas"}
          </button>
        </div>
        <div className="row">
          {["Lista", "Cards"].map((v) => (
            <IconButton
              key={v}
              icon={v === "Lista" ? "ListChecks" : "LayoutDashboard"}
              label={v}
              onClick={() => setView(v)}
            />
          ))}
        </div>
      </div>
      <div className="cadence-metrics">
        <section className="panel panel-pad">
          <small>Enviados</small>
          <strong>{metrics?.sent??'—'}</strong>
          <small>{metrics?`${metrics.email} e-mail · ${metrics.whatsapp} WhatsApp`:'Métricas ainda não disponíveis'}</small>
        </section>
        <section className="panel panel-pad">
          <small>Respostas</small>
          <strong>{metrics?.replies??'—'}</strong>
          <small>últimos {period} dias</small>
        </section>
        <section className="panel panel-pad">
          <small>Abertura de e-mail</small>
          <strong>—</strong>
          <small>rastreamento indisponível</small>
        </section>
        <section className="panel panel-pad">
          <small>Hoje</small>
          <strong>{metrics?metrics.today.email+metrics.today.whatsapp:'—'}</strong>
          <small>envios registrados hoje</small>
        </section>
      </div>
      {list.length ? (
        view === "Lista" ? (
          <div className="panel table-scroll">
            <table className="data-table cadence-table">
              <thead>
                <tr>
                  {[
                    "CADÊNCIA",
                    "LEADS",
                    "ENVIADOS",
                    "RESPONDERAM",
                    "ABERTURA",
                    "HOJE",
                    "AÇÃO",
                  ].map((t) => (
                    <th key={t}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/cadences/${c.id}`}>{c.name}</Link>{" "}
                      <Badge>
                        {c.status === "draft"
                          ? "Rascunho"
                          : c.status === "paused"
                            ? "Pausada"
                            : c.status}
                      </Badge>
                      <small>
                        {s.lists.find((l) => l.id === c.listId)?.name}
                      </small>
                    </td>
                    <td>
                      {s.leads.filter((l) => l.listId === c.listId).length}
                    </td>
                    <td>{cadenceMetrics[c.id]?.sent??'—'}</td>
                    <td>{cadenceMetrics[c.id]?.replies??'—'}</td>
                    <td>—</td>
                    <td>{cadenceMetrics[c.id]?cadenceMetrics[c.id].today.email+cadenceMetrics[c.id].today.whatsapp:'—'}</td>
                    <td>
                      <div className="row">
                        <Button variant="soft" onClick={() => messaging?router.push(`/cadences/${c.id}?tab=publication`):setGate(true)}>
                          {publications.some(p=>p.cadenceId===c.id&&p.state==='active')?'Ver publicação':'Ativar'}
                        </Button>
                        <Link
                          className="icon-btn"
                          aria-label={`Editar fluxo de ${c.name}`}
                          href={`/cadences/${c.id}`}
                        >
                          <Icon name="Pencil" size={16} />
                        </Link>
                        <IconButton
                          icon="Inbox"
                          label={`${c.archived ? "Restaurar" : "Arquivar"} ${c.name}`}
                          onClick={async () =>
                            await run(
                              async () =>
                                await repo.saveCadenceDraft({
                                  ...c,
                                  archived: !c.archived,
                                }),
                              c.archived
                                ? "Cadência restaurada."
                                : "Cadência arquivada.",
                            )
                          }
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="cadence-card-grid">
            {list.map((c) => (
              <section className="panel panel-pad" key={c.id}>
                <div className="row between"><Badge>{c.status==='draft'?'Rascunho':c.status==='paused'?'Pausada':c.status==='active'?'Ativa':'Concluída'}</Badge><Icon name="Workflow" size={18}/></div>
                <h3 className="section-gap"><Link href={`/cadences/${c.id}`}>{c.name}</Link></h3>
                <p className="muted">
                  {c.steps.length} etapas ·{" "}
                  {s.leads.filter((l) => l.listId === c.listId).length} leads
                </p>
                <p className="cadence-card-list">{s.lists.find(l=>l.id===c.listId)?.name??'Sem lista vinculada'}</p>
                <div className="section-gap">
                  <LinkButton href={`/cadences/${c.id}`} icon="Pencil">
                    Editar sequência
                  </LinkButton>
                </div>
              </section>
            ))}
          </div>
        )
      ) : (
        <EmptyState
          icon="Send"
          title="Nenhuma cadência encontrada"
          description="Crie uma sequência ou ajuste seus filtros."
        />
      )}
      {create && (
        <Modal
          wide
          title={
            mode === "models"
              ? "Modelos de cadência"
              : mode === "clone"
                ? "Clonar cadência"
                : "Criar cadência"
          }
          description="Escolha como você quer montar sua sequência de mensagens."
          onClose={() => {
            setCreate(false);
            setMode("");
          }}
        >
          {!mode ? (
            <div className="mode-grid">
              {[
                [
                  "Com IA",
                  "Diga o objetivo. Compare três réguas e revise as mensagens.",
                  "WandSparkles",
                  "/cadences/new/ai",
                ],
                [
                  "Modelos",
                  "Comece por uma sequência pronta e ajuste ao seu público.",
                  "Layers",
                  "models",
                ],
                [
                  "Clonar",
                  "Reutilize uma cadência sua como rascunho.",
                  "Copy",
                  "clone",
                ],
                [
                  "Do zero",
                  "Monte as etapas no editor visual.",
                  "FileText",
                  "/cadences/new",
                ],
              ].map(([label, desc, icon, url]) =>
                url.startsWith("/") ? (
                  <Link key={label} href={url} className="mode-option">
                    <div className="mode-art">
                      <span>
                        <Icon name={icon} size={28} />
                      </span>
                    </div>
                    <h3>{label}</h3>
                    <p>{desc}</p>
                  </Link>
                ) : (
                  <button
                    key={label}
                    className="mode-option"
                    onClick={() => setMode(url)}
                  >
                    <div className="mode-art">
                      <span>
                        <Icon name={icon} size={28} />
                      </span>
                    </div>
                    <h3>{label}</h3>
                    <p>{desc}</p>
                  </button>
                ),
              )}
            </div>
          ) : (
            <div className="stack">
              {mode === "models"
                ? [
                    "Primeiro contato",
                    "Retomar quem sumiu",
                    "Reativar base",
                  ].map((t, i) => (
                    <Button key={t} onClick={() => useModel(i)}>
                      {t}
                      <Icon name="ArrowRight" size={16} />
                    </Button>
                  ))
                : s.cadences.map((c) => (
                    <Button
                      key={c.id}
                      icon="Copy"
                      onClick={async () => {
                        const clone = {
                          ...structuredClone(c),
                          id: crypto.randomUUID(),
                          name: c.name + " · Cópia",
                          archived: false,
                        };
                        if (
                          await run(
                            async () => await repo.saveCadenceDraft(clone),
                          )
                        )
                          router.push(`/cadences/${clone.id}`);
                      }}
                    >
                      {c.name}
                    </Button>
                  ))}
              <Button variant="ghost" onClick={() => setMode("")}>
                Voltar
              </Button>
            </div>
          )}
        </Modal>
      )}
      {gate && (
        <Modal
          title="Conecte um canal antes de ligar"
          onClose={() => setGate(false)}
        >
          <Notice>
            As cadências estão em rascunho. A execução real depende dos serviços
            de canal e agendamento, ainda não integrados nesta demonstração.
          </Notice>
          <div className="form-actions">
            <Button onClick={() => setGate(false)}>Fechar</Button>
            <LinkButton href="/settings/whatsapp" variant="primary">
              Ver canais
            </LinkButton>
          </div>
        </Modal>
      )}
    </div>
  );
}
