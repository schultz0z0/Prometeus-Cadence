"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDemo, useRepository, useAction } from "@/demo/provider";
import { defaultCadenceSettings } from "@/demo/seed";
import { validateCadence, eligibleCadenceLeads } from "@/domain/cadence";
import type { Cadence } from "@/domain/model";
import { qualificationLabels, qualificationTones } from "@/domain/model";
import { Icon } from "@/components/ui/icon";
import { Badge, Button, IconButton, Modal, Notice, LinkButton, EmptyState, } from "@/components/ui/primitives";
import { SequenceCanvas } from "./sequence-canvas";
import { CadenceSettings } from "./cadence-settings";
export function CadenceEditor({ id }: {
    id: string;
}) {
    const s = useDemo();
    const repo = useRepository();
    const run = useAction();
    const router = useRouter();
    const original = s.cadences.find((c) => c.id === id);
    const [c, setC] = useState<Cadence>(() => original
        ? structuredClone(original)
        : {
            id: id === "new" ? crypto.randomUUID() : id,
            name: "Nova cadência",
            listId: s.lists[0]?.id ?? "",
            status: "draft",
            createdAt: new Date().toISOString(),
            settings: defaultCadenceSettings(),
            steps: [],
        });
    const [tab, setTab] = useState("Sequência");
    const [dirty, setDirty] = useState(false);
    const [issues, setIssues] = useState<string[]>([]);
    const [optimize, setOptimize] = useState(false);
    const leads = eligibleCadenceLeads(c, s.leads);
    useEffect(() => {
        if (!dirty)
            return;
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [dirty]);
    function change(next: Cadence) {
        setC(next);
        setDirty(true);
    }
    async function save() {
        const errors = validateCadence(c);
        setIssues(errors.map((x) => x.message));
        if (!errors.length && await run(async () => await repo.saveCadenceDraft(c), "Rascunho salvo. Nenhum envio foi ativado.")) {
            setDirty(false);
            if (id === "new")
                router.replace(`/cadences/${c.id}`);
        }
    }
    if (!original && id !== "new")
        return (<EmptyState title="Cadência não encontrada" description="Volte à lista para encontrar seus rascunhos.">
        <LinkButton href="/cadences">Ver cadências</LinkButton>
      </EmptyState>);
    return (<>
      <section className="panel cadence-header">
        <div className="cadence-title-row">
          <Link href="/cadences" className="icon-btn" aria-label="Voltar às cadências">
            <Icon name="ArrowLeft"/>
          </Link>
          <div className="grow">
            <input aria-label="Nome da cadência" className="cadence-name-input" value={c.name} onChange={(e) => change({ ...c, name: e.target.value })}/>
            <div className="row">
              <Badge>Rascunho</Badge>
              <small>
                · {c.steps.length} etapas ·{" "}
                {s.lists.find((l) => l.id === c.listId)?.name}
              </small>
              {dirty && <Badge tone="orange">Alterações não salvas</Badge>}
            </div>
          </div>
          <div className="row wrap">
            <Button variant="soft" icon="Sparkles" onClick={() => setOptimize(true)}>
              Otimizar
            </Button>
            <Button icon="Clock" onClick={save}>
              Salvar rascunho
            </Button>
            <Button variant="primary" icon="Save" onClick={save}>
              Salvar alterações
            </Button>
          </div>
        </div>
        <div className="tabs editor-tabs" role="tablist" aria-label="Seções da cadência">
          {[
            ["Sequência", "Workflow", String(c.steps.length)],
            ["Leads", "Users", String(leads.length)],
            ["Saúde", "ChartNoAxesColumn", ""],
            ["Relatório", "ChartNoAxesColumn", ""],
            ["Configurações", "Settings", ""],
        ].map(([name, icon, count]) => (<button role="tab" aria-selected={tab === name} key={name} className={tab === name ? "active" : ""} onClick={() => setTab(name)}>
              <Icon name={icon} size={16}/>
              {name}
              {count && <Badge>{count}</Badge>}
            </button>))}
        </div>
      </section>
      {issues.length > 0 && (<div className="section-gap">
          <Notice tone="error">
            {issues.map((x) => (<p key={x}>{x}</p>))}
          </Notice>
        </div>)}
      {tab === "Sequência" ? (<>
          <section className="panel sequence-estimate">
            <div className="row between">
              <h3 className="row">
                <Icon name="Sparkles" size={17} className="orange"/>
                Com essa configuração
              </h3>
              <small>{leads.length} leads elegíveis · demonstração</small>
            </div>
            <p>
              Prepare sua sequência.{" "}
              <span>Conexões serão medidas quando a cadência rodar.</span>
            </p>
            <small>
              Os canais ainda não estão conectados. Nenhuma estimativa de
              resposta foi inventada.
            </small>
          </section>
          <SequenceCanvas cadence={c} onChange={change} onSettings={() => setTab("Configurações")}/>
        </>) : tab === "Configurações" ? (<>
          <CadenceSettings cadence={c} onChange={change}/>
          <div className="form-actions">
            <Button variant="primary" icon="Save" onClick={save}>
              Salvar alterações
            </Button>
          </div>
        </>) : tab === "Leads" ? (<section className="panel table-scroll section-gap">
          <table className="data-table">
            <thead>
              <tr>
                <th>LEAD</th>
                <th>CONTATO</th>
                <th>QUALIFICAÇÃO</th>
                <th>CADÊNCIA</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (<tr key={l.id}>
                  <td>
                    <Link href={`/leads/${l.id}`}>{l.name}</Link>
                  </td>
                  <td>{l.email || l.phone || "sem contato"}</td>
                  <td>
                    <Badge tone={qualificationTones[l.qualification]}>
                      {qualificationLabels[l.qualification]}
                    </Badge>
                  </td>
                  <td>
                    <Badge>Aguardando</Badge>
                  </td>
                </tr>))}
            </tbody>
          </table>
          {!leads.length && (<EmptyState icon="Users" title="Nenhum lead elegível" description="Confira a lista e os vereditos aceitos nas configurações."/>)}
        </section>) : (<section className="panel section-gap">
          <EmptyState icon={tab === "Saúde" ? "Shield" : "ChartNoAxesColumn"} title={tab === "Saúde"
                ? "A cadência ainda não enviou"
                : "Nenhuma execução registrada"} description={tab === "Saúde"
                ? "Conecte os canais para acompanhar entrega, falhas e reputação."
                : "O relatório será preenchido por eventos reais de envio e resposta."}>
            <LinkButton href="/settings/whatsapp">Conectar um canal</LinkButton>
          </EmptyState>
        </section>)}
      {optimize && (<Modal title="Revisão da sequência" onClose={() => setOptimize(false)}>
          <Notice>
            A otimização com IA real ainda não está integrada. Você pode revisar
            cada etapa, os intervalos e os critérios de entrada.
          </Notice>
          <ul className="explainer-list">
            <li>Faça uma pergunta simples no primeiro contato.</li>
            <li>Confira as variáveis com um lead da lista.</li>
            <li>Ative a parada automática por resposta.</li>
            <li>Defina intervalos adequados para cada canal.</li>
          </ul>
          <Button variant="primary" onClick={() => {
                setOptimize(false);
                setTab("Configurações");
            }}>
            Revisar configurações
          </Button>
        </Modal>)}
    </>);
}
