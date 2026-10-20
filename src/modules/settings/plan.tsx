"use client";
import { useState } from "react";
import { useDemo } from "@/demo/provider";
import { Badge, Button, Modal, Notice } from "@/components/ui/primitives";
export function Plan() {
  const s = useDemo();
  const [tab, setTab] = useState("Meu plano");
  const [gate, setGate] = useState(false);
  const usage = [
    ["Extrações de leads/mês", 0, 5000],
    [
      "Importações/mês",
      s.leads.filter((l) => l.source === "MANUAL").length,
      5000,
    ],
    ["Contas de e-mail", 0, 3],
    ["Cadências ativas", 0, 100],
    ["Templates", s.templates.length, 0],
    ["Automações ativas", 0, 50],
  ] as const;
  return (
    <>
      <div className="tabs">
        {["Meu plano", "Cobrança", "Planos e pacotes"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Meu plano" ? (
        <>
          <section className="panel panel-pad">
            <div className="row between">
              <h2>Workspace de demonstração</h2>
              <Badge tone="orange">Local</Badge>
            </div>
            <p className="secondary-text section-gap">
              Prepare sua prospecção. Nenhuma assinatura, cartão ou cobrança
              está ativo nesta versão.
            </p>
            <div className="section-gap">
              <Button variant="primary" onClick={() => setGate(true)}>
                Conhecer planos
              </Button>
            </div>
          </section>
          <section className="panel panel-pad section-gap">
            <h3>Uso do plano · exemplo de cotas</h3>
            <div className="usage-grid">
              {usage.map(([label, value, max]) => (
                <div key={label}>
                  <div className="row between">
                    <span>{label}</span>
                    <span>
                      <strong>{value}</strong>
                      <small> / {max || "ilimitado"}</small>
                    </span>
                  </div>
                  <div className="usage-track">
                    <i
                      style={{
                        width: `${max ? Math.min(100, (value / max) * 100) : 0}%`,
                      }}
                    />
                  </div>
                  <small>
                    {max
                      ? `${Math.round((value / max) * 100)}% utilizado`
                      : "Sem limite no exemplo"}
                  </small>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : tab === "Cobrança" ? (
        <section className="panel panel-pad">
          <h2>Sem cobrança ativa</h2>
          <p className="secondary-text section-gap">
            Nenhum meio de pagamento foi cadastrado. Faturas, recibos e
            renovação aparecerão aqui depois da integração de cobrança.
          </p>
          <div className="section-gap">
            <Notice>
              Esta versão não abre checkout e não contrata serviços.
            </Notice>
          </div>
        </section>
      ) : (
        <div className="plan-grid">
          {[
            [
              "Essential",
              "Para começar a prospecção ativa",
              "5.000 extrações",
              "3 contas de e-mail",
              "Cadências de e-mail e WhatsApp",
              "2 assentos",
            ],
            [
              "Pro",
              "Para times e operação multicanal",
              "8.000 extrações",
              "5 contas de e-mail",
              "LinkedIn e Agente SDR",
              "3 assentos",
            ],
          ].map(([name, desc, ...features]) => (
            <section key={name} className="panel panel-pad">
              <Badge tone="orange">Catálogo de referência</Badge>
              <h2 className="section-gap">{name}</h2>
              <p className="secondary-text section-gap">{desc}</p>
              <strong className="plan-price">Preço a configurar</strong>
              <ul className="explainer-list">
                {features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <Button variant="primary" onClick={() => setGate(true)}>
                Ver detalhes
              </Button>
            </section>
          ))}
        </div>
      )}
      {gate && (
        <Modal title="Planos e cobrança" onClose={() => setGate(false)}>
          <Notice>
            O catálogo comercial e o checkout do Prometeus Cadence serão
            configurados na etapa de assinatura. Os valores do produto de
            referência não foram adotados como preço do seu SaaS.
          </Notice>
          <div className="form-actions">
            <Button onClick={() => setGate(false)}>Entendi</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
