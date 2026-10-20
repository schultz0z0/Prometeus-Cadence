"use client";
import Link from "next/link";
import { useState } from "react";
import { useDemo, useRepository, useAction } from "@/demo/provider";
import { Button, Field, PageHeader, Modal, Notice, LinkButton, } from "@/components/ui/primitives";
const modules = [
    [
        "email",
        "Extrair e-mails",
        "Abre o site do lead e recolhe os e-mails que encontrar.",
    ],
    [
        "phone",
        "Extrair telefones",
        "Abre o site do lead e recolhe os telefones que encontrar.",
    ],
    [
        "website",
        "Descobrir site",
        "Encontra o site a partir do e-mail profissional.",
    ],
    [
        "summary",
        "Resumo com IA",
        "Escreve o que a empresa faz, a partir do que está no site.",
    ],
    [
        "deep",
        "Extração profunda",
        "Navega páginas internas como contato e sobre.",
    ],
    [
        "validateEmail",
        "Validar e-mail",
        "Confere o domínio e a existência da caixa.",
    ],
    [
        "registry",
        "Enriquecer via Receita Federal",
        "Busca dados empresariais pelo CNPJ do lead.",
    ],
    [
        "qualify",
        "Qualificar com IA",
        "Avalia se o lead combina com o seu negócio.",
    ],
];
export function Qualifier() {
    const s = useDemo();
    const repo = useRepository();
    const run = useAction();
    const [list, setList] = useState("");
    const [selected, setSelected] = useState<string[]>([]);
    const [search, setSearch] = useState("");
    const [onlySite, setOnlySite] = useState(true);
    const [noEmail, setNoEmail] = useState(false);
    const [checked, setChecked] = useState(["email", "summary", "validateEmail"]);
    const [confirm, setConfirm] = useState(false);
    const [limit, setLimit] = useState(500);
    const [lng, setLng] = useState("Português");
    const leads = s.leads.filter((l) => l.listId === list &&
        (!onlySite || l.site) &&
        (!noEmail || !l.email) &&
        l.name.toLowerCase().includes(search.toLowerCase()));
    const eligible = leads.filter((l) => selected.includes(l.id)).slice(0, limit);
    async function simulate() {
        if (await run(async () => {
            await Promise.all(eligible.map(async (l) => await repo.upsertLead({
                ...l,
                qualification: checked.includes("qualify")
                    ? l.site
                        ? "qualified"
                        : "warning"
                    : l.qualification,
                summary: checked.includes("summary")
                    ? "Resumo de demonstração: empresa fictícia. Nenhum site foi lido ou modelo de IA consultado."
                    : l.summary,
                reason: checked.includes("qualify")
                    ? "Veredito demonstrativo baseado apenas na presença de site."
                    : l.reason,
            })));
            await repo.addJob({
                id: crypto.randomUUID(),
                name: "Qualificação local",
                type: "qualification",
                status: "completed",
                count: eligible.length,
                demo: true,
                billableUsage: 0,
                createdAt: new Date().toISOString(),
                details: checked.join(", "),
            });
        }, "Simulação de qualificação concluída.")) {
            setSelected([]);
            setConfirm(false);
        }
    }
    return (<>
      <div className="one-time-note">
        Isto qualifica uma lista, uma vez.{" "}
        <Link href="/automations/new">
          Para qualificar sozinho o que chegar, crie uma automação →
        </Link>
      </div>
      <PageHeader title="Qualificador de Leads" description="Qualifique leads com extração de contatos e resumos por IA" actions={<LinkButton href="/executions" icon="Clock">
            Histórico
          </LinkButton>}/>
      <div className="stack">
        <section className="panel panel-pad">
          <h3 className="numbered-heading">
            <span className="number-circle">1</span>Selecionar Lista de Leads
          </h3>
          <div className="section-gap">
            <Field label="Lista de leads">
              <select value={list} onChange={(e) => {
            setList(e.target.value);
            setSelected([]);
        }}>
                <option value="">Selecione uma lista…</option>
                {s.lists.map((l) => (<option key={l.id} value={l.id}>
                    {l.name} ({s.leads.filter((x) => x.listId === l.id).length}{" "}
                    leads)
                  </option>))}
              </select>
            </Field>
          </div>
        </section>
        {list && (<>
            <section className="panel panel-pad">
              <h3 className="numbered-heading">
                <span className="number-circle">2</span>Selecionar Leads para
                Qualificar
              </h3>
              <div className="row wrap section-gap">
                <input className="search-field" placeholder="Buscar lead…" aria-label="Buscar lead" value={search} onChange={(e) => setSearch(e.target.value)}/>
                <Button onClick={() => setSelected(leads.map((l) => l.id))}>
                  Selecionar todos
                </Button>
                <Button variant="ghost" onClick={() => setSelected([])}>
                  Limpar
                </Button>
                <small>
                  {eligible.length} de {leads.length} selecionados
                </small>
              </div>
              <div className="row wrap section-gap">
                <label className="row">
                  <input type="checkbox" checked={onlySite} onChange={(e) => setOnlySite(e.target.checked)}/>
                  Apenas com site
                </label>
                <label className="row">
                  <input type="checkbox" checked={noEmail} onChange={(e) => setNoEmail(e.target.checked)}/>
                  Sem e-mail preenchido
                </label>
              </div>
              <div className="selection-list section-gap">
                {leads.map((l) => (<label key={l.id}>
                    <input type="checkbox" checked={selected.includes(l.id)} onChange={(e) => setSelected(e.target.checked
                    ? [...selected, l.id]
                    : selected.filter((id) => id !== l.id))}/>
                    <span>
                      {l.name}
                      <small>{l.site || "sem site"}</small>
                    </span>
                  </label>))}
                {!leads.length && (<p className="muted">Nenhum lead corresponde aos filtros.</p>)}
              </div>
            </section>
            <section className="panel panel-pad">
              <h3 className="numbered-heading">
                <span className="number-circle">3</span>Configurar Módulos de
                Qualificação
              </h3>
              <div className="modules-grid">
                {modules.map(([id, title, desc]) => (<label key={id}>
                    <input type="checkbox" checked={checked.includes(id)} onChange={(e) => setChecked(e.target.checked
                    ? [...checked, id]
                    : checked.filter((x) => x !== id))}/>
                    <span>
                      <strong>{title}</strong>
                      <p>{desc}</p>
                    </span>
                  </label>))}
              </div>
              <div className="field-grid">
                <Field label="Idioma">
                  <select value={lng} onChange={(e) => setLng(e.target.value)}>
                    <option>Português</option>
                    <option>English</option>
                    <option>Español</option>
                  </select>
                </Field>
                <Field label="Limite de leads">
                  <input min="1" max="500" type="number" value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(500, Number(e.target.value))))}/>
                </Field>
              </div>
              <div className="notice section-gap">
                Validação real de e-mail, WhatsApp e enriquecimento exigem um
                provedor conectado.
              </div>
              <div className="form-actions">
                <Button variant="primary" icon="Sparkles" disabled={!eligible.length || !checked.length} onClick={() => setConfirm(true)}>
                  Simular qualificação de {eligible.length} leads
                </Button>
              </div>
            </section>
          </>)}
      </div>
      {confirm && (<Modal title="Confirmar qualificação demonstrativa" onClose={() => setConfirm(false)}>
          <Notice>
            Nenhum dado será extraído nem validado externamente. Os{" "}
            {eligible.length} contatos selecionados receberão somente um
            resultado de demonstração.
          </Notice>
          <div className="form-actions">
            <Button onClick={() => setConfirm(false)}>Cancelar</Button>
            <Button variant="primary" onClick={simulate}>
              Confirmar simulação
            </Button>
          </div>
        </Modal>)}
    </>);
}
