"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useDemo, useRepository, useAction } from "@/demo/provider";
import { suggestDemoAudiences } from "@/demo/audience";
import {useIdentity} from '@/client/workspace-provider';
import {ServerAudienceWizard} from './server-audience-wizard';
import {
  sourceLabels,
  type AudiencePlan,
  type ConfirmationResult,
} from "@/domain/model";
import { Icon } from "@/components/ui/icon";
import {
  Button,
  Field,
  PageHeader,
  Steps,
  ChannelPills,
  Notice,
  LinkButton,
  Modal,
} from "@/components/ui/primitives";
const examples = [
  "clínicas de estética em São Paulo",
  "indústrias de embalagem no Sul",
  "escritórios de contabilidade com mais de 10 funcionários",
  "lojas de material de construção do interior",
];
export function AudienceWizard({initialJob}:{initialJob?:string}) {
  const identity=useIdentity();return identity?<ServerAudienceWizard initialJob={initialJob}/>:<DemoAudienceWizard/>;
}
function DemoAudienceWizard() {
  const s = useDemo();
  const repo = useRepository();
  const run = useAction();
  const [description, setDescription] = useState("");
  const [channel, setChannel] = useState<"whatsapp" | "email" | "both">(
    "whatsapp",
  );
  const [step, setStep] = useState(0);
  const [plans, setPlans] = useState<AudiencePlan[]>([]);
  const [chosen, setChosen] = useState<AudiencePlan | null>(null);
  const [result, setResult] = useState<ConfirmationResult | null>(null);
  const [createdName, setCreatedName] = useState("");
  const [createdLimit, setCreatedLimit] = useState(150);
  const [createdChannel, setCreatedChannel] =
    useState<AudiencePlan["channel"]>("whatsapp");
  const request = useRef(crypto.randomUUID());
  function suggest() {
    setPlans(
      suggestDemoAudiences({ description, channel, profile: s.companyProfile }),
    );
    request.current = crypto.randomUUID();
    setStep(1);
  }
  async function confirm() {
    if (!chosen) return;
    let r: ConfirmationResult | undefined;
    if (
      await run(async () => {
        r = await repo.confirmAutomationPlan(chosen, request.current);
      }, "Lista e automações criadas, ainda pausadas.")
    ) {
      setCreatedName(chosen.title);
      setCreatedLimit(chosen.dailyLimit);
      setCreatedChannel(chosen.channel);
      setChosen(null);
      setResult(r!);
      setStep(2);
    }
  }
  return (
    <div className="workflow-reference ai-workflow-reference audience-ai-reference">
      <PageHeader
        title={result ? "Pronto" : "Nova automação com IA"}
        description={
          result
            ? "A lista e as duas automações já existem no seu workspace."
            : "Diga quem você quer alcançar. A IA monta a busca e a qualificação."
        }
        back="/automations"
      />
      {!result && (
        <Steps items={["Quem alcançar", "Escolher o plano"]} current={step} />
      )}
      {step === 0 ? (
        <div className="workspace-form">
          <div>
            <section className="panel panel-pad">
              <h3 className="panel-title">
                <Icon name="Building2" size={17} />
                Quem você quer alcançar
              </h3>
              <div className="audience-entry">
                <div>
                  <textarea
                    aria-label="Quem você quer alcançar"
                    placeholder="Ex.: clínicas de estética em São Paulo que já têm mais de um consultório"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                  <small>
                    Em branco, usamos o seu Contexto de IA para sugerir três
                    públicos.
                  </small>
                </div>
                <div className="audience-examples">
                  <small>EXEMPLOS QUE FUNCIONAM</small>
                  {examples.map((e) => (
                    <button key={e} onClick={() => setDescription(e)}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            </section>
            <section className="panel panel-pad section-gap">
              <h3 className="panel-title">
                <Icon name="WandSparkles" size={17} />
                Por onde você vai falar
              </h3>
              <ChannelPills
                value={channel}
                onChange={(v) => setChannel(v as typeof channel)}
              />
              <small className="section-note">
                A busca prioriza empresas com o contato necessário para o canal
                escolhido.
              </small>
            </section>
            <div className="form-actions">
              <Button variant="primary" icon="Sparkles" onClick={suggest}>
                Montar o plano com IA
              </Button>
            </div>
            <p className="demo-footnote">
              Prévia de demonstração: as propostas são modelos locais. Nenhum
              serviço de IA é consultado.
            </p>
          </div>
          <aside className="aside-info">
            <h3>O que a IA vai montar</h3>
            <p>
              <strong>Uma lista</strong> vazia, com o nome do público que você
              descreveu.
            </p>
            <p>
              <strong>Uma busca</strong> que roda todo dia e enche essa lista
              com empresas novas, sem repetir as que já entraram.
            </p>
            <p>
              <strong>Uma qualificação</strong> que analisa cada empresa e marca
              quem combina com o que você vende.
            </p>
            <footer>
              No próximo passo você vê três propostas antes de escolher. Nada é
              criado até você confirmar uma delas.
            </footer>
          </aside>
        </div>
      ) : step === 1 ? (
        <>
          <div className="proposal-grid">
            {plans.map((p) => (
              <section className="panel proposal-card" key={p.id}>
                <h2>{p.title}</h2>
                <p>{p.description}</p>
                <div className="market-size">
                  sem número <span>empresas</span>
                </div>
                <small>
                  Tamanho do mercado não consultado nesta demonstração
                </small>
                <div className="proposal-description">
                  <p>O que vai ser criado</p>
                  <p>Lista “{p.listName}”</p>
                  <p>Buscar · todo dia, no {sourceLabels[p.source]}</p>
                  <p>Qualificar · avalia o perfil de cada empresa</p>
                  <p>
                    Até {p.dailyLimit} empresas por dia quando a integração
                    estiver ativa.
                  </p>
                </div>
                <Button
                  variant="primary"
                  onClick={() => setChosen(structuredClone(p))}
                >
                  Criar assim <Icon name="ArrowRight" size={16} />
                </Button>
              </section>
            ))}
          </div>
          <div className="proposal-actions">
            <Button variant="ghost" onClick={() => setStep(0)}>
              Mudar o público
            </Button>
            <Button
              variant="ghost"
              icon="RefreshCw"
              onClick={() => {
                setPlans([...plans.slice(1), plans[0]]);
                request.current = crypto.randomUUID();
              }}
            >
              Reordenar propostas
            </Button>
          </div>
          <p className="demo-footnote">
            Propostas demonstrativas. Fontes e contagens reais dependem da
            conexão dos provedores.
          </p>
        </>
      ) : result ? (
        <div className="workspace-form">
          <div>
            <section className="success-panel">
              <h3>
                <Icon name="CheckCircle2" size={21} className="green-text" />
                {createdName}
              </h3>
              <p className="row">
                <Icon name="Database" size={16} className="orange" />
                Busca todo dia às 7h, até {createdLimit} empresas novas por dia.
              </p>
              <p className="row">
                <Icon name="Sparkles" size={16} className="orange" />
                Qualificação às 8h: avalia cada empresa e marca quem combina.
              </p>
              <div className="notice">
                As duas nasceram pausadas: conecte os serviços antes de ligar.
              </div>
            </section>
            <div className="row wrap section-gap">
              <LinkButton
                href={`/cadences/new/ai?list=${result.listId}&channel=${createdChannel}`}
                variant="primary"
              >
                Criar a cadência dessa lista{" "}
                <Icon name="ArrowRight" size={16} />
              </LinkButton>
              <LinkButton
                href={`/contacts?list=${result.listId}`}
                variant="ghost"
              >
                Ver a lista
              </LinkButton>
              <LinkButton href="/automations" variant="ghost">
                Ir pras automações
              </LinkButton>
            </div>
            <small className="section-note">
              A cadência sai só para quem for qualificado. Dá pra mudar isso na
              própria cadência.
            </small>
          </div>
          <aside className="aside-info">
            <h3>A partir de agora</h3>
            <p>
              <strong>Busca e qualificação:</strong> os horários estão
              configurados, mas a execução depende de serviços conectados e
              ativação.
            </p>
            <p>
              <strong>Falta a régua:</strong> sem uma cadência ligada nessa
              lista, os leads ficam esperando. É o próximo passo.
            </p>
            <footer>
              Nenhuma mensagem foi enviada. A lista e as automações ficaram
              salvas no seu workspace.
            </footer>
          </aside>
        </div>
      ) : null}
      {chosen && (
        <Modal
          title="Revisar e criar"
          description="Confira o público e os efeitos desta confirmação."
          onClose={() => setChosen(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              confirm();
            }}
          >
            <div className="stack">
              <Field label="Nome da lista">
                <input
                  required
                  value={chosen.listName}
                  onChange={(e) =>
                    setChosen({ ...chosen, listName: e.target.value })
                  }
                />
              </Field>
              <Field
                label="Nome da automação"
                help="Este nome identifica a automação. Os critérios da busca são revisados abaixo."
              >
                <textarea
                  required
                  value={chosen.title}
                  onChange={(e) =>
                    setChosen({ ...chosen, title: e.target.value })
                  }
                />
              </Field>
              <Field label="Termos da busca">
                <textarea
                  required
                  value={chosen.filters.term ?? ""}
                  onChange={(e) =>
                    setChosen({
                      ...chosen,
                      filters: { ...chosen.filters, term: e.target.value },
                    })
                  }
                />
              </Field>
              <Field
                label="Região da busca"
                help="Confira a região sugerida antes de confirmar."
              >
                <input
                  required
                  value={chosen.filters.location ?? ""}
                  onChange={(e) =>
                    setChosen({
                      ...chosen,
                      filters: { ...chosen.filters, location: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Canal de contato">
                <select
                  value={chosen.channel}
                  onChange={(e) =>
                    setChosen({
                      ...chosen,
                      channel: e.target.value as AudiencePlan["channel"],
                    })
                  }
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">E-mail</option>
                  <option value="both">Os dois</option>
                </select>
              </Field>
              <Field label="Fonte de busca">
                <select
                  value={chosen.source}
                  onChange={(e) =>
                    setChosen({
                      ...chosen,
                      source: e.target.value as AudiencePlan["source"],
                    })
                  }
                >
                  <option value="MAPS">Google Maps</option>
                  <option value="WEB">Busca na web</option>
                  <option value="CNPJ">Base CNPJ</option>
                </select>
              </Field>
              <Field label="Limite diário">
                <input
                  type="number"
                  min="1"
                  max="500"
                  required
                  value={chosen.dailyLimit}
                  onChange={(e) =>
                    setChosen({ ...chosen, dailyLimit: Number(e.target.value) })
                  }
                />
              </Field>
              <Notice>
                Esta confirmação cria uma lista e duas automações pausadas. Não
                ativa busca, cobrança ou envio.
              </Notice>
            </div>
            <div className="form-actions">
              <Button type="button" onClick={() => setChosen(null)}>
                Voltar
              </Button>
              <Button type="submit" variant="primary">
                Confirmar criação
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
