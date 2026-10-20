"use client";
import { useState } from "react";
import {
  Button,
  LinkButton,
  Modal,
  Notice,
  EmptyState,
} from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
export function Channels({ section }: { section: string }) {
  const [connect, setConnect] = useState("");
  const [type, setType] = useState("Gmail");
  return (
    <>
      {section === "whatsapp" ? (
        <>
          <h1>WhatsApp</h1>
          <p className="subtitle">
            Por qual número as cadências mandam mensagem.
          </p>
          <div className="channel-cards">
            <section className="panel panel-pad">
              <div className="channel-heading">
                <span className="meta-symbol">∞</span>
                <div>
                  <h2>WhatsApp Oficial (Meta)</h2>
                  <small>não conectado</small>
                </div>
              </div>
              <ul className="channel-benefits">
                <li>
                  <Icon name="CheckCircle2" />
                  Inicia conversas com templates aprovados
                </li>
                <li>
                  <Icon name="CheckCircle2" />
                  Gerencia limites pela conta na Meta
                </li>
                <li>
                  <Icon name="CheckCircle2" />
                  Mensagens por template aprovado pela Meta
                </li>
              </ul>
              <Button
                variant="primary"
                onClick={() => setConnect("WhatsApp Oficial (Meta)")}
              >
                Conectar <Icon name="ChevronDown" size={14} />
              </Button>
            </section>
            <section className="panel panel-pad">
              <div className="channel-heading">
                <span className="whatsapp-symbol">
                  <Icon name="MessageSquare" size={22} />
                </span>
                <div>
                  <h2>Número próprio</h2>
                  <small>nenhum número</small>
                </div>
              </div>
              <ul className="channel-benefits">
                <li>
                  <Icon name="CheckCircle2" />
                  Pelo QR Code ou pela sua Z-API
                </li>
                <li>
                  <Icon name="CheckCircle2" />
                  Responde e continua conversas
                </li>
                <li>
                  <Icon name="AlertCircle" />O número é seu: ritmo mais
                  conservador
                </li>
              </ul>
              <Button onClick={() => setConnect("Número próprio")}>
                Conectar <Icon name="ChevronDown" size={14} />
              </Button>
            </section>
          </div>
          <p className="section-note">
            Sem número conectado, as cadências de WhatsApp não saem.
          </p>
        </>
      ) : section === "email" ? (
        <>
          <div className="row between wrap">
            <div>
              <h1>Contas de e-mail</h1>
              <p className="subtitle">
                Conecte suas caixas para enviar e receber mensagens pelas
                cadências.
              </p>
            </div>
            <Button
              variant="primary"
              icon="Plus"
              onClick={() => setConnect("E-mail")}
            >
              Conectar e-mail
            </Button>
          </div>
          <EmptyState
            icon="Mail"
            title="Nenhuma conta de e-mail configurada"
            description="Adicione uma conta para enviar e-mails pelas cadências."
          >
            <Button icon="Plus" onClick={() => setConnect("E-mail")}>
              Adicionar conta
            </Button>
          </EmptyState>
        </>
      ) : (
        <>
          <h1>Limites de disparo</h1>
          <p className="subtitle">
            Quantas mensagens cada conta ou número pode mandar por dia.
          </p>
          <section className="settings-section">
            <h2>E-mail</h2>
            <p className="settings-desc">
              O limite é por caixa e compartilhado por todas as cadências que a
              usam.
            </p>
            <div className="panel panel-pad">
              <h3>Nenhuma conta de e-mail</h3>
              <p className="muted section-gap">
                Os limites aparecem quando você conecta uma conta.
              </p>
              <div className="section-gap">
                <LinkButton href="/settings/email">Contas de e-mail</LinkButton>
              </div>
            </div>
            <div className="settings-divider" />
            <h2>WhatsApp</h2>
            <p className="settings-desc">
              O ritmo de envio varia por tipo de conexão e limite da conta.
            </p>
            <div className="panel panel-pad">
              <h3>Nenhum número de WhatsApp</h3>
              <p className="muted section-gap">
                Os limites aparecem quando você conecta um número.
              </p>
              <div className="section-gap">
                <LinkButton href="/settings/whatsapp">WhatsApp</LinkButton>
              </div>
            </div>
          </section>
        </>
      )}
      {connect && (
        <Modal title={`Conectar ${connect}`} onClose={() => setConnect("")}>
          <p className="secondary-text">
            Esta conexão precisa do backend e do provedor de canal, que ainda
            não foram integrados.
          </p>
          {connect === "E-mail" && (
            <div className="row wrap section-gap">
              {["Gmail", "Microsoft 365", "SMTP / IMAP"].map((v) => (
                <button
                  key={v}
                  className={`pill ${type === v ? "selected" : ""}`}
                  onClick={() => setType(v)}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
          <div className="section-gap">
            <Notice>
              Nenhum QR Code ou autenticação será iniciado nesta demonstração.
              Você pode preparar as cadências e mantê-las em rascunho.
            </Notice>
          </div>
          <div className="form-actions">
            <Button onClick={() => setConnect("")}>Entendi</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
