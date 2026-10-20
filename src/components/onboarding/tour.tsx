"use client";
import { useState } from "react";
import { Button, Modal, LinkButton } from "../ui/primitives";
import { Icon } from "../ui/icon";
const tour = [
  {
    title: "Como tudo se liga",
    body: "Encontre empresas que podem comprar de você, escreva a mensagem e organize os próximos contatos. Você revisa e confirma antes de ligar.",
    icon: "Compass",
  },
  {
    title: "O painel: seus resultados",
    body: "Aqui você acompanha leads, qualificados, mensagens e respostas. Os números desta versão vêm da base local de demonstração.",
    icon: "LayoutDashboard",
  },
  {
    title: "O menu, na ordem do trabalho",
    body: "Contatos guarda as empresas. Disparos em Massa organiza as cadências. Mensagens reúne as respostas. Automações repete o trabalho aprovado.",
    icon: "Workflow",
  },
  {
    title: "Pra quem: as listas",
    body: "Agrupe seu público e qualifique cada empresa antes de colocá-la em uma cadência.",
    icon: "Users",
  },
  {
    title: "O que e quando: a cadência",
    body: "Monte uma sequência com mensagens e intervalos. Revise o texto de cada etapa e salve como rascunho.",
    icon: "Send",
  },
  {
    title: "Por onde sai: o canal",
    body: "Conecte e-mail, WhatsApp ou LinkedIn nas configurações. Nesta demonstração, os canais permanecem desconectados.",
    icon: "MessageSquare",
  },
  {
    title: "Quem respondeu: Mensagens",
    body: "O histórico do contato e suas respostas ficam juntos. Respostas e opt-outs devem interromper os próximos envios.",
    icon: "Inbox",
  },
  {
    title: "Pra não parar: automações",
    body: "A busca encontra novos leads, a qualificação avalia o perfil e a cadência organiza o contato. Você escolhe o público e confirma a criação.",
    icon: "Workflow",
  },
  {
    title: "Seu próximo passo",
    body: "Siga o checklist de primeiros passos para revisar o contexto, a lista e sua primeira sequência.",
    icon: "Compass",
  },
  {
    title: "Tudo pronto para explorar",
    body: "Explore os formulários, crie listas e edite cadências. Os dados ficam salvos apenas neste navegador.",
    icon: "CheckCircle2",
  },
];
export function Tour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const t = tour[step];
  return (
    <Modal title={t.title} onClose={onClose}>
      <div className="tour-symbol">
        <Icon name={t.icon} size={23} />
        <small>{step + 1} DE 10</small>
      </div>
      <p>{t.body}</p>
      <div className="tour-example">
        Você só olha durante o passeio; nenhum dado é alterado.
      </div>
      <div className="tour-footer">
        <div className="tour-dots">
          {tour.map((_, i) => (
            <i key={i} className={i <= step ? "filled" : ""} />
          ))}
        </div>
        <div className="row">
          {step > 0 && (
            <Button
              variant="ghost"
              icon="ArrowLeft"
              onClick={() => setStep(step - 1)}
            >
              Voltar
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => (step === 9 ? onClose() : setStep(step + 1))}
          >
            {step === 9 ? "Concluir" : "Próximo"}
            <Icon name="ArrowRight" size={16} />
          </Button>
        </div>
      </div>
    </Modal>
  );
}
export function FirstSteps() {
  return (
    <>
      <h1>Primeiros passos</h1>
      <p className="subtitle">
        Da sua empresa à primeira conversa, em seis etapas.
      </p>
      <div className="panel checklist-full">
        {[
          [
            "Contexto de IA",
            "Revise o que a IA sabe sobre sua empresa.",
            "/settings/context",
          ],
          [
            "Escolher seu público",
            "Monte uma lista de empresas para prospectar.",
            "/automations/new/ai",
          ],
          [
            "Criar uma cadência",
            "Revise as mensagens e o ritmo de follow-up.",
            "/cadences/new/ai",
          ],
          [
            "Conectar um canal",
            "E-mail, WhatsApp ou LinkedIn.",
            "/settings/whatsapp",
          ],
          [
            "Revisar e ligar",
            "Confira canais e limites antes de enviar.",
            "/cadences",
          ],
          [
            "Acompanhar respostas",
            "Converse com quem demonstrar interesse.",
            "/inbox",
          ],
        ].map(([title, body, href], i) => (
          <div key={title}>
            <span className={`number-circle ${i < 3 ? "done" : ""}`}>
              {i < 3 ? <Icon name="Check" size={16} /> : i + 1}
            </span>
            <div className="grow">
              <h3>{title}</h3>
              <p className="secondary-text">{body}</p>
            </div>
            <LinkButton href={href} icon="ArrowRight">
              {i < 3 ? "Revisar" : "Abrir"}
            </LinkButton>
          </div>
        ))}
      </div>
    </>
  );
}
