"use client";
import { useState } from "react";
import { useDemo, useRepository, useAction, useNotify } from "@/demo/provider";
import { useIdentity, useCapabilities } from "@/client/workspace-provider";
import { approveProfile, mergeProfileSuggestion } from "@/domain/context";
import type { CompanyProfile } from "@/domain/model";
import { Icon } from "@/components/ui/icon";
import { Badge, Button, Field, Notice } from "@/components/ui/primitives";
import {ContextSuggestions} from './context-suggestions';
import {ProductProfiles} from './product-profiles';
export function CompanyContext() {
  const identity = useIdentity(),
    capabilities = useCapabilities();
  const s = useDemo();
  const repo = useRepository();
  const run = useAction();
  const notify = useNotify();
  const [p, setP] = useState<CompanyProfile>(structuredClone(s.companyProfile));
  const [open, setOpen] = useState("overview");
  const fields: [keyof CompanyProfile, string, string][] = [
    [
      "idealCustomer",
      "Perfil de cliente",
      "Quem compra, quem usa e quem não é cliente",
    ],
    ["pains", "Dores e resultados", "O que dói no cliente e o que ele ganha"],
    ["differentiators", "Diferenciais", "Por que você e não o concorrente"],
    ["competitors", "Concorrentes", "Com quem o cliente compara"],
    ["socialProof", "Prova social", "Números, clientes e cases"],
    ["sources", "Outros detalhes", "Limitações e fontes"],
  ];
  function set(key: keyof CompanyProfile, v: string) {
    setP({ ...p, [key]: v, approvedAt: null });
  }
  return (
    <div className="settings-reference context-reference">
      <div className="row between wrap">
        <div>
          <h1>Contexto de IA</h1>
          <p className="subtitle">
            O que a IA sabe da sua empresa quando escreve mensagens, escolhe leads, monta cadências e treina o agente. Lemos o seu site, você revisa e aprova.
          </p>
        </div>
      </div>
      <div className="row wrap context-used">
        <small>Usado em:</small>
        <Badge>cadências</Badge>
        <Badge>agente SDR</Badge>
        <Badge>qualificação</Badge>
        <span className="context-approval-date">{p.approvedAt?`Aprovado em ${new Date(p.approvedAt).toLocaleDateString('pt-BR')}`:'Rascunho'}</span>
      </div>
      <div className="company-context-layout">
        <aside className="company-context-nav">
          <div className="context-company-card"><div className="row">
            <span className="avatar">{p.name.slice(0, 1)}</span>
            <div>
              <strong>{p.name}</strong>
              <small>{p.domain}</small>
            </div>
          </div>
          <div className="row section-gap">
            <input
              aria-label="Site da empresa"
              value={p.domain}
              onChange={(e) => set("domain", e.target.value)}
            />
            {identity?<ContextSuggestions current={p} onChange={setP}/>:<Button
              onClick={() => {
                setP(mergeProfileSuggestion(p, {}));
                notify(
                  "Releitura real ainda não integrada. Seus campos foram preservados.",
                );
              }}
            >
              Reler
            </Button>}
          </div></div>
          <div className="context-knowledge-nav"><small className="section-note">PERFIL DA EMPRESA</small>
          <button
            className="context-nav-active"
            onClick={() => setOpen("overview")}
            aria-current={open==='overview'?'true':undefined}
          >
            Quem é a empresa{" "}
            <Badge tone={p.approvedAt ? "green" : "neutral"}>
              {p.approvedAt ? "Aprovado" : "Rascunho"}
            </Badge>
          </button>
          </div>
          {identity&&<div className="context-products"><ProductProfiles domain={p.domain} companyRevision={s.companyProfile.version}/></div>}
        </aside>
        <section>
          <Notice>
            {identity?'A leitura do site gera uma proposta com fontes. Aceitar campos altera somente o rascunho; aprovar e salvar é uma ação separada.':'O que você corrigir vale mais que o que a IA leu. Nesta demonstração, o contexto é editado e aprovado localmente.'}
          </Notice>
          <div className="context-accordion">
            <button
              className="context-accordion-head"
              onClick={() => setOpen(open === "overview" ? "" : "overview")}
              aria-expanded={open==='overview'}
            >
              <span>
                <strong>Visão geral</strong>
                <small>O que a empresa faz, pra quem e como cobra</small>
              </span>
              <span className="context-field-count">{[p.domain,p.name,p.offer,p.products].filter(value=>value.trim()).length} de 4</span>
              <Icon
                name={open === "overview" ? "ChevronUp" : "ChevronDown"}
                size={17}
              />
            </button>
            {open === "overview" && (
              <div className="context-accordion-body stack">
                <Field label="Domínio da empresa">
                  <input
                    readOnly
                    value={p.domain}
                    onChange={(e) => set("domain", e.target.value)}
                  />
                </Field>
                <Field label="Nome da empresa">
                  <input
                    value={p.name}
                    onChange={(e) => set("name", e.target.value)}
                  />
                </Field>
                <Field label="Oferta (visão geral)">
                  <textarea
                    rows={3}
                    value={p.offer}
                    onChange={(e) => set("offer", e.target.value)}
                  />
                </Field>
                <Field
                  label="Produtos e serviços em destaque"
                  help="Um por linha: Nome | uma linha de descrição."
                >
                  <textarea
                    rows={7}
                    value={p.products}
                    onChange={(e) => set("products", e.target.value)}
                  />
                </Field>
              </div>
            )}
          </div>
          {fields.map(([key, title, description]) => (
            <div className="context-accordion" key={key}>
              <button
                className="context-accordion-head"
                onClick={() => setOpen(open === key ? "" : key)}
                aria-expanded={open===key}
              >
                <span>
                  <strong>{title}</strong>
                  <small>{description}</small>
                </span>
                <span className="context-field-count">{String(p[key]??'').trim()?1:0} de 1</span>
                <Icon
                  name={open === key ? "ChevronUp" : "ChevronDown"}
                  size={17}
                />
              </button>
              {open === key && (
                <div className="context-accordion-body">
                  <Field label={title}>
                    <textarea
                      rows={6}
                      value={String(p[key] ?? "")}
                      onChange={(e) => set(key, e.target.value)}
                    />
                  </Field>
                </div>
              )}
            </div>
          ))}
        </section>
      </div>
      <div className="context-save-bar">
        <small>
          Versão {s.companyProfile.version} ·{" "}
          {identity ? "persistência no servidor" : "salvo no navegador"}
        </small>
        <div className="row">
          <Button
            onClick={async () => {
              if (
                await run(
                  async () =>
                    await repo.saveContext({ ...p, approvedAt: null }),
                  "Contexto salvo como rascunho.",
                )
              )
                setP(repo.getSnapshot().companyProfile);
            }}
          >
            Salvar rascunho
          </Button>
          <Button
            variant="primary"
            icon="CheckCircle2"
            disabled={
              !p.name.trim() ||
              !p.offer.trim() ||
              (!!identity && !capabilities?.includes("context.approve"))
            }
            onClick={async () => {
              const approved = approveProfile(p, new Date().toISOString());
              if (
                await run(
                  async () => await repo.saveContext(approved),
                  "Contexto aprovado e salvo.",
                )
              )
                setP(repo.getSnapshot().companyProfile);
            }}
          >
            Aprovar e salvar
          </Button>
        </div>
      </div>
    </div>
  );
}
