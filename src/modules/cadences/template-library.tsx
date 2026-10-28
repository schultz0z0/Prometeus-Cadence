"use client";
import { useEffect, useState } from "react";
import { ReferenceEmptyArt } from "@/components/ui/reference-empty-art";
import { useDemo, useRepository, useAction } from "@/demo/provider";
import type { Template } from "@/domain/model";
import {authoringVariables,validateAuthoringVariables} from "@/domain/message-authoring";
import { renderStepPreview } from "@/domain/cadence";
import {
  Button,
  IconButton,
  PageHeader,
  Modal,
  Field,
  EmptyState,
  Badge,
  Notice,
} from "@/components/ui/primitives";
const variables=authoringVariables;
export function TemplateLibrary() {
  const s = useDemo();
  const repo = useRepository();
  const run = useAction();
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("Todos");
  const [view, setView] = useState("Cards");
  const [editing, setEditing] = useState<Template | null>(null);
  const [remove, setRemove] = useState<Template | null>(null);
  const [lastRemoved, setLastRemoved] = useState<Template | null>(null);
  const [previewList, setPreviewList] = useState("");
  const [tagInput,setTagInput]=useState('');
  useEffect(()=>setTagInput(''),[editing?.id]);
  const filtered = s.templates.filter(
    (t) =>
      (channel === "Todos" ||
        t.channel === (channel === "Email" ? "EMAIL" : "WHATSAPP")) &&
      t.name.toLowerCase().includes(query.toLowerCase()),
  );
  const sample = s.leads.find((l) => !previewList || l.listId === previewList);
  const preview = editing && sample ? renderStepPreview(editing, sample) : null;
  return (
    <div className="templates-reference">
      <PageHeader
        title="Meus templates"
        description={
          "Seus textos prontos de e-mail e WhatsApp, reutilize nos passos de qualquer cadência com “Usar template”."
        }
        actions={
          <Button
            icon="Plus"
            variant="primary"
            onClick={() =>
              setEditing({
                id: crypto.randomUUID(),
                name: "",
                channel: "EMAIL",
                tags: [],
                subject: "",
                body: "",
              })
            }
          >
            Novo template
          </Button>
        }
      />
      <div className="row between wrap">
        <div className="row wrap">
          <input
            className="search-field"
            type="search"
            aria-label="Buscar templates"
            placeholder="Buscar templates…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {["Todos", "Email", "WhatsApp"].map((x) => (
            <button
              key={x}
              className={`pill ${channel === x ? "selected" : ""}`}
              onClick={() => setChannel(x)}
            >
              {x}
            </button>
          ))}
        </div>
        <div className="row">
          <small>{filtered.length} template(s)</small>
          {["Lista", "Cards"].map((x) => (
            <Button
              key={x}
              variant={view === x ? "soft" : ""}
              onClick={() => setView(x)}
            >
              {x}
            </Button>
          ))}
        </div>
      </div>
      {lastRemoved && (
        <div className="notice section-gap">
          Template removido.{" "}
          <button
            className="orange"
            onClick={async () => {
              await run(
                async () => await repo.saveTemplate(lastRemoved),
                "Template restaurado.",
              );
              setLastRemoved(null);
            }}
          >
            Desfazer
          </button>
        </div>
      )}
      {!filtered.length && <div className="template-reference-art"><ReferenceEmptyArt kind="templates"/></div>}
      {filtered.length ? (
        <div className={view === "Cards" ? "template-grid" : "template-list"}>
          {filtered.map((t) => (
            <section className="panel panel-pad" key={t.id}>
              <div className="row between">
                <h3>{t.name}</h3>
                <Badge tone={t.channel === "EMAIL" ? "purple" : "green"}>
                  {t.channel === "EMAIL" ? "E-mail" : "WhatsApp"}
                </Badge>
              </div>
              <p className="secondary-text section-gap preview-clamp">
                {t.body}
              </p>
              <div className="row between section-gap">
                <div className="row">
                  {t.tags.map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
                </div>
                <div className="row">
                  <IconButton
                    icon="Pencil"
                    label={`Editar ${t.name}`}
                    onClick={() => setEditing(structuredClone(t))}
                  />
                  <IconButton
                    icon="Trash2"
                    label={`Excluir ${t.name}`}
                    onClick={() => setRemove(t)}
                  />
                </div>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="FileText"
          title="Crie seu primeiro template"
          description="Salve seus melhores textos e reutilize nas cadências."
        >
          <Button
            variant="primary"
            icon="Plus"
            onClick={() =>
              setEditing({
                id: crypto.randomUUID(),
                name: "",
                channel: "EMAIL",
                tags: [],
                subject: "",
                body: "",
              })
            }
          >
            Criar template
          </Button>
        </EmptyState>
      )}
      {!s.templates.length && <div className="template-reference-teaching">{[["Escreva uma vez","E-mail ou WhatsApp, com variáveis como o nome da empresa."],["Use nas cadências","Reutilize seus melhores textos nos passos de cada cadência."],["WhatsApp Oficial","A primeira mensagem precisa ser um template aprovado pela Meta."]].map(([title,text])=><section className="panel" key={title}><h3>{title}</h3><p>{text}</p></section>)}</div>}
      {editing && (
        <Modal
          wide
          title={
            s.templates.some((t) => t.id === editing.id)
              ? "Editar template"
              : "Novo template"
          }
          onClose={() => setEditing(null)}
        >
          <form className="template-reference-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await run(
                  async () => await repo.saveTemplate(editing),
                  "Template salvo.",
                )
              )
                setEditing(null);
            }}
          >
            <div className="template-reference-fields"><div className="field-grid">
              <Field label="Nome *">
                <input
                  autoFocus
                  placeholder="Ex: Follow-up 1"
                  required
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                />
              </Field>
              <Field label="Canal">
                <select
                  value={editing.channel}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      channel: e.target.value as Template["channel"],
                    })
                  }
                >
                  <option value="EMAIL">Email</option>
                  <option value="WHATSAPP">WhatsApp</option>
                </select>
              </Field>
            </div>
            <div className="stack section-gap">
              <Field label="Tags (opcional)">
                <span className="template-reference-tags"><input value={tagInput} placeholder="Ex: follow-up, prospecção, onboarding" onChange={e=>setTagInput(e.target.value)}/><Button type="button" onClick={()=>{setEditing({...editing,tags:[...new Set([...editing.tags,...tagInput.split(',').map(x=>x.trim()).filter(Boolean)])]});setTagInput('');}}>Adicionar</Button></span>
                {!!editing.tags.length&&<span className="row wrap">{editing.tags.map(tag=><button type="button" className="token-button" key={tag} onClick={()=>setEditing({...editing,tags:editing.tags.filter(x=>x!==tag)})}>{tag} ×</button>)}</span>}
              </Field>
              {editing.channel === "EMAIL" && (
                <Field label="Assunto">
                  <input
                    placeholder="Ex: {{nome}}, posso te ajudar?"
                    value={editing.subject ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, subject: e.target.value })
                    }
                  />
                </Field>
              )}
              <Field label="Corpo *">
                <textarea
                  placeholder="Olá {{nome}}, tudo bem? Vi que vocês são de {{cidade}} e podem…"
                  rows={6}
                  required
                  value={editing.body}
                  onChange={(e) =>
                    setEditing({ ...editing, body: e.target.value })
                  }
                />
              </Field>
              {validateAuthoringVariables({body:(editing.subject??'')+'\n'+editing.body,allowed:authoringVariables}).unknown.length>0&&<Notice>Há variáveis desconhecidas neste template. Corrija-as antes de publicar uma cadência.</Notice>}
              <div className="row wrap">
                <small>Inserir:</small>
                {variables.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className="token-button"
                    onClick={() =>
                      setEditing({
                        ...editing,
                        body: editing.body + "{{" + v + "}}",
                      })
                    }
                  >
                    {"{{" + v + "}}"}
                  </button>
                ))}
              </div>
              <aside className="panel panel-pad template-reference-preview">
                <h3>Como vai chegar</h3>
                <select
                  className="section-gap"
                  aria-label="Lista para prévia"
                  value={previewList}
                  onChange={(e) => setPreviewList(e.target.value)}
                >
                  <option value="">Lead de exemplo</option>
                  {s.lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                {editing.channel === "EMAIL" && preview?.subject && (
                  <h4>{preview.subject}</h4>
                )}
                <p className="message-preview">
                  {preview?.text || "Nenhum contato disponível para a prévia."}
                </p>
                {preview?.unresolved.length ? (
                  <Notice>
                    Variáveis sem valor: {preview.unresolved.join(", ")}
                  </Notice>
                ) : null}
              </aside>
            </div>
            </div><div className="form-actions">
              <Button type="button" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button variant="primary" type="submit">
                {s.templates.some(t=>t.id===editing.id)?'Salvar template':'Criar template'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {remove && (
        <Modal title="Excluir template?" onClose={() => setRemove(null)}>
          <p>“{remove.name}” será removido. Você pode desfazer nesta página.</p>
          <div className="form-actions">
            <Button onClick={() => setRemove(null)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (
                  await run(async () => await repo.deleteTemplate(remove.id))
                ) {
                  setLastRemoved(remove);
                  setRemove(null);
                }
              }}
            >
              Excluir template
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
