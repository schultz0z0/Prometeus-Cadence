"use client";
import { useState } from "react";
import { Button, Modal, Notice, LinkButton } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
export function Integrations() {
  const [selected, setSelected] = useState("");
  return (
    <>
      <h1>CRM e apps</h1>
      <p className="subtitle">
        Integrações nativas: o lead sai daqui e aparece lá, sem código.
      </p>
      <div className="integration-stack">
        {[
          [
            "FunnelsFlow CRM",
            "Leads gerados, qualificados ou que responderam viram contatos e negócios no CRM.",
            "Workflow",
          ],
          [
            "Google Planilhas",
            "Cada lead gerado, qualificado ou que respondeu vira uma linha na sua planilha.",
            "Columns3",
          ],
          [
            "Apollo",
            "Busque pessoas por cargo, setor, tamanho e local ou importe as listas que você já tem.",
            "Target",
          ],
        ].map(([name, desc, icon]) => (
          <section className="panel panel-pad" key={name}>
            <div className="row between">
              <h2 className="row">
                <Icon name={icon} size={24} className="orange" />
                {name}
              </h2>
              <Button onClick={() => setSelected(name)}>Conectar</Button>
            </div>
            <p className="secondary-text section-gap">{desc}</p>
            <small className="section-note">não conectado</small>
          </section>
        ))}
      </div>
      <section className="settings-section">
        <h2>Outro sistema?</h2>
        <p className="settings-desc">
          Para n8n, Zapier, Make ou um CRM sem integração nativa, use webhooks
          de saída.
        </p>
        <LinkButton href="/settings/webhooks" icon="Link2">
          Webhooks e API
        </LinkButton>
      </section>
      {selected && (
        <Modal title={`Conectar ${selected}`} onClose={() => setSelected("")}>
          <Notice>
            O adaptador de {selected} ainda não foi integrado. Não informe
            chaves ou credenciais nesta demonstração.
          </Notice>
          <div className="form-actions">
            <Button onClick={() => setSelected("")}>Fechar</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
