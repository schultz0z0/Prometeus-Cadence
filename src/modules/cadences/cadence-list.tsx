"use client";
import Link from "next/link";
import { useState } from "react";
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
  );
  function useModel(index: number) {
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
    if (run(() => repo.saveCadenceDraft(c), "Modelo salvo como rascunho."))
      router.push(`/cadences/${c.id}`);
  }
  return (
    <>
      <PageHeader
        title="Cadências"
        description={`${s.cadences.filter((c) => !c.archived).length} cadências · 0 ativas`}
        actions={
          <Button variant="primary" icon="Plus" onClick={() => setCreate(true)}>
            Nova cadência
          </Button>
        }
      />
      <section className="panel cadence-today">
        <h3>Hoje</h3>
        {[
          ["0", "JÁ SAÍRAM"],
          ["0", "AINDA HOJE"],
          ["0", "FICAM PRA DEPOIS"],
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
          <strong>0</strong>
          <small>0 e-mail · 0 WhatsApp</small>
        </section>
        <section className="panel panel-pad">
          <small>Respostas</small>
          <strong>0</strong>
          <small>nenhuma mensagem enviada</small>
        </section>
        <section className="panel panel-pad">
          <small>Abertura de e-mail</small>
          <strong>—</strong>
          <small>sem envios rastreados</small>
        </section>
        <section className="panel panel-pad">
          <small>Hoje</small>
          <strong>0</strong>
          <small>nenhuma régua rodou ainda</small>
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
                    <td>0</td>
                    <td>0</td>
                    <td>—</td>
                    <td>0</td>
                    <td>
                      <div className="row">
                        <Button variant="soft" onClick={() => setGate(true)}>
                          Ativar
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
                          onClick={() =>
                            run(
                              () =>
                                repo.saveCadenceDraft({
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
          <div className="template-grid">
            {list.map((c) => (
              <section className="panel panel-pad" key={c.id}>
                <Badge>Rascunho</Badge>
                <h3 className="section-gap">{c.name}</h3>
                <p className="muted">
                  {c.steps.length} etapas ·{" "}
                  {s.leads.filter((l) => l.listId === c.listId).length} leads
                </p>
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
                      onClick={() => {
                        const clone = {
                          ...structuredClone(c),
                          id: crypto.randomUUID(),
                          name: c.name + " · Cópia",
                          archived: false,
                        };
                        if (run(() => repo.saveCadenceDraft(clone)))
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
    </>
  );
}
