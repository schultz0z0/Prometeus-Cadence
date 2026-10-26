"use client";
import { useState,useEffect,useCallback } from "react";
import {useLiveRefresh} from '@/client/use-live-refresh';
import {useAutomationClient,useCapabilities} from '@/client/workspace-provider';
import type {AutomationRuntime} from '@/domain/automation-runtime';
import {RuntimeControls} from './runtime-controls';
import {ScheduleFields} from './schedule-fields';
import {scheduleV2Schema} from '@/domain/schedule';
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
  const client=useAutomationClient(),caps=useCapabilities(),canEdit=!client||caps?.includes('data.write');
  const [runtimes,setRuntimes]=useState<Record<string,AutomationRuntime>>({}),[runtimeError,setRuntimeError]=useState('');
  const refreshRuntime=useCallback(async()=>{if(client){const rows=await client.list();setRuntimes(Object.fromEntries(rows.map(r=>[r.definition.id,r.runtime])));setRuntimeError('');}},[client]);
  useEffect(()=>{void refreshRuntime().catch(e=>setRuntimeError(e.message));},[refreshRuntime]);
  useLiveRefresh(async signal=>{if(!client)return;const rows=await client.list();if(!signal.aborted){setRuntimes(Object.fromEntries(rows.map(r=>[r.definition.id,r.runtime])));setRuntimeError('');}},15000,!!client,client);
  const automations=client?s.automations.map(a=>({...a,status:!runtimes[a.id]?a.status:runtimes[a.id].status==='active'?'active' as const:runtimes[a.id].status==='blocked'?'error' as const:'paused' as const})):s.automations;
  const [create, setCreate] = useState(false);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Automation | null>(null);
  const [execute, setExecute] = useState(false);
  const [order, setOrder] = useState("recent");
  const [comfortable, setComfortable] = useState(true);
  const [groupBy,setGroupBy]=useState('source'),[collapsed,setCollapsed]=useState<string[]>([]),[listFilter,setListFilter]=useState('');
  const [frequency, setFrequency] = useState<"daily" | "">("");
  const [module, setModule] = useState("");
  const filtered = filterAutomations(automations, { frequency, module })
    .filter(
      (a) =>
        (!source || a.source === source) &&
        (!status || (status==='never'?a.status==='active'&&!runtimes[a.id]?.lastRunAt:a.status === status)) &&
        (!listFilter||a.listId===listFilter)&&
        [a.name, a.description, ...Object.values(a.filters),s.lists.find((l) => l.id === a.listId)?.name]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .toSorted((a, b) =>
      order === "name"
        ? a.name.localeCompare(b.name)
        : order==='oldest'?a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt),
    );
  const groupKey=(a:Automation)=>groupBy==='source'?a.source:groupBy==='status'?a.status:groupBy==='frequency'?a.schedule.frequency:'all';
  const groupLabel=(group:string)=>groupBy==='source'?sourceLabels[group as Source]:groupBy==='status'?({active:'Ligada',paused:'Pausada',draft:'Rascunho',error:'Com erro'}[group]??group):groupBy==='frequency'?({daily:'Diária',weekly:'Semanal',biweekly:'Quinzenal',monthly:'Mensal',once:'Única',custom:'Personalizada'}[group]??group):'Todas as automações';
  const groups = Array.from(new Set(filtered.map(groupKey)));
  const sourceOpts = Array.from(new Set(s.automations.map((a) => a.source)));
  return (
    <div className="workflow-reference automation-reference">
      <PageHeader
        title="Automações"
        description={`${s.automations.length} automações · ${automations.filter((a) => a.status === "active").length} ligadas`}
        actions={
          <Button disabled={!canEdit} variant="primary" icon="Plus" onClick={() => setCreate(true)}>
            Nova automação
          </Button>
        }
      />
      {runtimeError&&<p role="alert" className="error-bar">{runtimeError}<button onClick={()=>void refreshRuntime().catch(e=>setRuntimeError(e.message))}>Tentar novamente</button></p>}
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
          aria-label="Agrupar por"
          value={groupBy}
          onChange={(e) => {setGroupBy(e.target.value);setCollapsed([]);}}
        >
          <option value="source">Agrupar por fonte</option><option value="status">Por estado</option><option value="frequency">Por frequência</option><option value="none">Sem agrupamento</option>
        </select>
        <select
          aria-label="Ordenação"
          value={order}
          onChange={(e) => setOrder(e.target.value)}
        >
          <option value="recent">Última criação</option>
          <option value="name">Nome A–Z</option>
          <option value="oldest">Mais antigas</option>
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
            setListFilter('');
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
              ["never", "Ligada, nunca rodou"],
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
                  {automations.filter((a) => k==='never'?a.status==='active'&&!runtimes[a.id]?.lastRunAt:a.status === k).length}
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
                  <small>{automations.filter(a=>a.modules.includes(m)).length}</small>
                </label>
              ),
            )}
          </section>
          <section className="panel filter-panel"><h4>LISTA</h4>{s.lists.map(list=><label key={list.id}><input type="checkbox" checked={listFilter===list.id} onChange={()=>setListFilter(listFilter===list.id?'':list.id)}/><span>{list.name}</span><small>{automations.filter(a=>a.listId===list.id).length}</small></label>)}</section>
        </aside>
        <div>
          {groups.map((group) => (
            <section className="panel automation-group" key={group}>
              <button type="button" className="automation-group-head" aria-expanded={!collapsed.includes(group)} onClick={()=>setCollapsed(value=>value.includes(group)?value.filter(x=>x!==group):[...value,group])}>
                <span className="dot orange" />
                {groupLabel(group)}
                <small>
                  {filtered.filter((a) => groupKey(a) === group).length}
                </small>
                <Icon name={collapsed.includes(group)?"ChevronRight":"ChevronDown"} size={14} className="muted" />
              </button>
              {!collapsed.includes(group)&&filtered
                .filter((a) => groupKey(a) === group)
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
                        <button disabled={!canEdit} onClick={() => setEditing(structuredClone(a))}>
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
                          name={a.source === "QUALIFY" ? "ListChecks" : "Database"}
                          size={12}
                        />
                        {sourceLabels[a.source]}
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
                    {client?<RuntimeControls compact id={a.id} runtime={runtimes[a.id]} onChange={refreshRuntime}/>:<><span className="automation-last">nunca rodou</span><Button
                      variant="soft"
                      icon="Play"
                      onClick={() => setExecute(true)}
                    >
                      Executar
                    </Button></>}
                    <IconButton
                      icon="MoreVertical"
                      label={`Editar ${a.name}`}
                      disabled={!canEdit}
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
                  async () => {if(client)scheduleV2Schema.parse(editing.schedule);await repo.saveAutomation(editing);await refreshRuntime();},
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
              </div>
              <ScheduleFields value={editing.schedule} onChange={schedule=>setEditing({...editing,schedule})}/>
              {editing.source==='QUALIFY'&&<Field label="Critérios de qualificação"><textarea value={editing.criteria??''} onChange={e=>setEditing({...editing,criteria:e.target.value})}/></Field>}
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
    </div>
  );
}
