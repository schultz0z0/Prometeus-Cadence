"use client";
import { useState } from "react";
import { useDemo, useRepository, useAction } from "@/demo/provider";
import { sourceLabels, type Source, type Automation } from "@/domain/model";
import {
  Badge,
  Button,
  IconButton,
  PageHeader,
  Modal,
  Field,
  Notice,
  LinkButton,
  EmptyState,
} from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { filterAutomations } from "@/domain/automation";
import { CreationModes } from "./creation-modes";
export function AutomationList() {
  const s = useDemo();
  const repo = useRepository();
  const run = useAction();
  const [create, setCreate] = useState(false);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Automation | null>(null);
  const [execute, setExecute] = useState(false);
  const [order, setOrder] = useState("recent");
  const [comfortable, setComfortable] = useState(true);
  const [frequency, setFrequency] = useState<"daily" | "">("");
  const [module, setModule] = useState("");
  const filtered = filterAutomations(s.automations, { frequency, module })
    .filter(
      (a) =>
        (!source || a.source === source) &&
        (!status || a.status === status) &&
        [a.name, a.description, s.lists.find((l) => l.id === a.listId)?.name]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .toSorted((a, b) =>
      order === "name"
        ? a.name.localeCompare(b.name)
        : b.createdAt.localeCompare(a.createdAt),
    );
  const groups = Array.from(new Set(filtered.map((a) => a.source)));
  const sourceOpts = Array.from(new Set(s.automations.map((a) => a.source)));
  return (
    <>
      <PageHeader
        title="Automações"
        description={`${s.automations.length} automações · ${s.automations.filter((a) => a.status === "active").length} ligadas`}
        actions={
          <Button variant="primary" icon="Plus" onClick={() => setCreate(true)}>
            Nova automação
          </Button>
        }
      />
      <div className="automation-toolbar">
        <div className="input-icon">
          <Icon name="Search" size={15} />
          <input
            placeholder="Procurar por nome, descrição, termo, cidade ou lista…"
            aria-label="Procurar automação"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="Fonte"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">Por fonte</option>
          {sourceOpts.map((x) => (
            <option key={x} value={x}>
              {sourceLabels[x]}
            </option>
          ))}
        </select>
        <select
          aria-label="Ordenação"
          value={order}
          onChange={(e) => setOrder(e.target.value)}
        >
          <option value="recent">Última criação</option>
          <option value="name">Nome A–Z</option>
        </select>
        <Button icon="Columns3" onClick={() => setComfortable(!comfortable)}>
          {comfortable ? "Confortável" : "Compacta"}
        </Button>
      </div>
      <div className="row">
        <small>VISUALIZAÇÕES</small>
        <button
          className="pill selected"
          onClick={() => {
            setStatus("");
            setSource("");
            setQuery("");
            setFrequency("");
            setModule("");
          }}
        >
          Todas
        </button>
      </div>
      <div className="filter-layout">
        <aside className="filter-stack">
          <section className="panel filter-panel">
            <h4>ESTADO</h4>
            {[
              ["active", "Ligada"],
              ["paused", "Pausada"],
              ["draft", "Rascunho"],
              ["error", "Com erro"],
            ].map(([k, label]) => (
              <label key={k}>
                <input
                  type="checkbox"
                  checked={status === k}
                  onChange={() => setStatus(status === k ? "" : k)}
                />
                <span className="dot" />
                {label}
                <small>
                  {s.automations.filter((a) => a.status === k).length}
                </small>
              </label>
            ))}
          </section>
          <section className="panel filter-panel">
            <h4>FONTE</h4>
            {sourceOpts.map((k) => (
              <label key={k}>
                <input
                  type="checkbox"
                  checked={source === k}
                  onChange={() => setSource(source === k ? "" : k)}
                />
                <span className="dot orange" />
                {sourceLabels[k]}
                <small>
                  {s.automations.filter((a) => a.source === k).length}
                </small>
              </label>
            ))}
          </section>
          <section className="panel filter-panel">
            <h4>FREQUÊNCIA</h4>
            <label>
              <input
                type="checkbox"
                checked={frequency === "daily"}
                onChange={() => setFrequency(frequency ? "" : "daily")}
              />
              Diária
              <small>
                {
                  s.automations.filter((a) => a.schedule.frequency === "daily")
                    .length
                }
              </small>
            </label>
          </section>
          <section className="panel filter-panel">
            <h4>CONTÉM O MÓDULO</h4>
            {["Qualificação por IA", "Resumo com IA", "Extrair telefones"].map(
              (m) => (
                <label key={m}>
                  <input
                    type="checkbox"
                    checked={module === m}
                    onChange={() => setModule(module === m ? "" : m)}
                  />
                  <Icon name="Sparkles" size={14} />
                  {m}
                </label>
              ),
            )}
          </section>
        </aside>
        <div>
          {groups.map((group) => (
            <section className="panel automation-group" key={group}>
              <div className="automation-group-head">
                <span className="dot orange" />
                {sourceLabels[group]}
                <small>
                  {filtered.filter((a) => a.source === group).length}
                </small>
                <Icon name="ChevronDown" size={14} className="muted" />
              </div>
              {filtered
                .filter((a) => a.source === group)
                .map((a) => (
                  <div
                    key={a.id}
                    className="automation-row"
                    style={
                      comfortable
                        ? undefined
                        : { paddingTop: 8, paddingBottom: 8 }
                    }
                  >
                    <div className="automation-name">
                      <div>
                        <span className="dot" />
                        <button onClick={() => setEditing(structuredClone(a))}>
                          <strong>{a.name}</strong>
                        </button>
                        <Badge tone="orange">
                          {a.status === "paused"
                            ? "pausada"
                            : a.status === "draft"
                              ? "rascunho"
                              : a.status === "error"
                                ? "com erro"
                                : "ligada"}
                        </Badge>
                      </div>
                      <p>{a.description}</p>
                    </div>
                    <div className="automation-tags">
                      <Badge tone="orange">
                        <Icon
                          name={group === "QUALIFY" ? "ListChecks" : "Database"}
                          size={12}
                        />
                        {sourceLabels[group]}
                      </Badge>
                      <Icon name="ArrowRight" size={12} className="muted" />
                      <Badge>
                        {s.lists.find((l) => l.id === a.listId)?.name}
                      </Badge>
                      {a.modules.map((m) => (
                        <Badge key={m}>
                          <Icon name="Sparkles" size={11} />
                          {m}
                        </Badge>
                      ))}
                      <Badge>
                        <Icon name="Clock" size={11} />
                        {a.schedule.frequency === "daily"
                          ? "Diária"
                          : a.schedule.frequency === "once"
                            ? "Única"
                            : a.schedule.frequency}{" "}
                        · {a.schedule.time}
                      </Badge>
                    </div>
                    <span className="automation-last">nunca rodou</span>
                    <Button
                      variant="soft"
                      icon="Play"
                      onClick={() => setExecute(true)}
                    >
                      Executar
                    </Button>
                    <IconButton
                      icon="MoreVertical"
                      label={`Editar ${a.name}`}
                      onClick={() => setEditing(structuredClone(a))}
                    />
                  </div>
                ))}
            </section>
          ))}
          {!filtered.length && (
            <EmptyState
              icon="Workflow"
              title="Nenhuma automação encontrada"
              description="Ajuste os filtros ou crie uma nova automação."
            />
          )}
          <small>
            {filtered.length} de {s.automations.length}
          </small>
        </div>
      </div>
      {create && <CreationModes onClose={() => setCreate(false)} />}
      {execute && (
        <Modal
          title="Esta automação ainda não pode rodar"
          onClose={() => setExecute(false)}
        >
          <Notice>
            Os provedores de busca, qualificação e envio ainda não estão
            conectados. A automação permanece pausada.
          </Notice>
          <div className="form-actions">
            <Button onClick={() => setExecute(false)}>Fechar</Button>
            <LinkButton href="/settings/apps" variant="primary">
              Ver integrações
            </LinkButton>
          </div>
        </Modal>
      )}
      {editing && (
        <Modal title="Editar automação" onClose={() => setEditing(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await run(
                  async () => await repo.saveAutomation(editing),
                  "Automação salva pausada.",
                )
              )
                setEditing(null);
            }}
          >
            <div className="stack">
              <Field label="Nome">
                <input
                  required
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                />
              </Field>
              <Field label="Descrição">
                <textarea
                  value={editing.description}
                  onChange={(e) =>
                    setEditing({ ...editing, description: e.target.value })
                  }
                />
              </Field>
              <div className="field-grid">
                <Field label="Limite por execução">
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={editing.dailyLimit}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        dailyLimit: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Horário">
                  <input
                    type="time"
                    required
                    value={editing.schedule.time}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        schedule: { ...editing.schedule, time: e.target.value },
                      })
                    }
                  />
                </Field>
              </div>
              <Notice>
                Permanece pausada até que os serviços estejam integrados e você
                confirme a ativação.
              </Notice>
            </div>
            <div className="form-actions">
              <Button type="button" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary">
                Salvar alterações
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
