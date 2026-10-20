"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useDemo, useRepository, useAction } from "@/demo/provider";
import { buildDemoCadenceOptions } from "@/demo/cadence";
import { validateCadence } from "@/domain/cadence";
import type { CadenceBrief, Cadence, Channel } from "@/domain/model";
import { Icon } from "@/components/ui/icon";
import {
  Button,
  Field,
  PageHeader,
  Steps,
  Badge,
  Notice,
} from "@/components/ui/primitives";
const objectives = [
  [
    "Primeiro contato",
    "Gente que nunca falou com você. Abre com o que você viu da empresa e uma pergunta.",
  ],
  [
    "Retomar quem sumiu",
    "Já conversou, mas parou. Retoma do ponto em que parou, sem culpa.",
  ],
  [
    "Proposta parada",
    "Mandou proposta e não teve resposta. Tira a dúvida do caminho e propõe o próximo passo.",
  ],
  [
    "Pós-evento ou webinar",
    "Quem se inscreveu ou passou no evento. Aproveita o gancho enquanto está quente.",
  ],
  [
    "Reativar base ou ex-clientes",
    "Clientes antigos ou base parada. Oferta ou novidade, sem parecer disparo.",
  ],
  [
    "Indicação ou parceria",
    "Alguém indicou, ou você quer propor parceria. Começa pelo nome em comum.",
  ],
];
export function CadenceWizard({
  initialList = "",
  initialChannel = "whatsapp",
}: {
  initialList?: string;
  initialChannel?: string;
}) {
  const s = useDemo();
  const repo = useRepository();
  const run = useAction();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [brief, setBrief] = useState<CadenceBrief>({
    listId: initialList || s.lists[0]?.id || "",
    objective: "Primeiro contato",
    channels:
      initialChannel === "email"
        ? ["EMAIL"]
        : initialChannel === "both"
          ? ["WHATSAPP", "EMAIL"]
          : ["WHATSAPP"],
    tone: "Pessoal",
    rhythm: "Padrão",
    highlight: "",
    avoid: "",
    decisionMaker: "",
    profile: s.companyProfile,
  });
  const [opts, setOpts] = useState<Cadence[]>([]);
  const [chosen, setChosen] = useState<Cadence | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  function generate() {
    setOpts(buildDemoCadenceOptions(brief));
    setStep(1);
  }
  async function save() {
    if (!chosen) return;
    const errors = validateCadence(chosen);
    setIssues(errors.map((e) => e.message));
    if (
      !errors.length &&
      (await run(
        async () => await repo.saveCadenceDraft(chosen),
        "Cadência criada como rascunho.",
      ))
    )
      router.push(`/cadences/${chosen.id}`);
  }
  return (
    <>
      <PageHeader
        title="Nova cadência com IA"
        description="Diga o objetivo e a lista. A IA escreve três opções; você escolhe e ajusta."
        back="/cadences"
      />
      <Steps
        items={["Sobre a cadência", "Opções da IA", "Revisar e criar"]}
        current={step}
      />
      {step === 0 ? (
        <div className="workspace-form">
          <div className="stack">
            <section className="panel panel-pad">
              <h3 className="panel-title">
                <Icon name="Building2" size={17} />O que a sua empresa vende
              </h3>
              <div className="context-summary">
                <strong className="row">
                  <Icon name="CheckCircle2" size={16} className="green-text" />
                  {s.companyProfile.name}
                  <small>· {s.companyProfile.domain}</small>
                </strong>
                <p>{s.companyProfile.offer}</p>
                <small>
                  Vem do seu Contexto de IA. Pra mudar,{" "}
                  <Link href="/settings/context" className="orange">
                    edite lá
                  </Link>
                  .
                </small>
              </div>
            </section>
            <section className="panel panel-pad">
              <h3 className="panel-title">
                <Icon name="Target" size={17} />
                Qual é o objetivo
              </h3>
              <div className="objective-grid">
                {objectives.map(([title, desc]) => (
                  <button
                    key={title}
                    className={`objective-option ${brief.objective === title ? "selected" : ""}`}
                    aria-pressed={brief.objective === title}
                    onClick={() => setBrief({ ...brief, objective: title })}
                  >
                    <strong>{title}</strong>
                    <small>{desc}</small>
                  </button>
                ))}
              </div>
            </section>
            <section className="panel panel-pad stack">
              <h3>Pra quem</h3>
              <Field label="Lista de contatos">
                <select
                  aria-label="Lista de contatos"
                  required
                  value={brief.listId}
                  onChange={(e) =>
                    setBrief({ ...brief, listId: e.target.value })
                  }
                >
                  {s.lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} (
                      {s.leads.filter((x) => x.listId === l.id).length})
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Quem decide (opcional)"
                help="Ajuda a escolher o registro certo: formal ou leve."
              >
                <input
                  value={brief.decisionMaker}
                  onChange={(e) =>
                    setBrief({ ...brief, decisionMaker: e.target.value })
                  }
                  placeholder="Ex.: sócio, gerente comercial…"
                />
              </Field>
            </section>
            <section className="panel panel-pad stack">
              <h3>Canais, tom e ritmo</h3>
              <div className="row wrap">
                {(
                  [
                    ["WHATSAPP", "WhatsApp", "MessageSquare"],
                    ["EMAIL", "E-mail", "Mail"],
                  ] as const
                ).map(([key, label, icon]) => (
                  <button
                    className={`pill ${brief.channels.includes(key) ? "selected" : ""}`}
                    aria-pressed={brief.channels.includes(key)}
                    key={key}
                    onClick={() =>
                      setBrief({
                        ...brief,
                        channels: brief.channels.includes(key)
                          ? brief.channels.filter((c) => c !== key)
                          : [...brief.channels, key],
                      })
                    }
                  >
                    <Icon name={icon} size={15} />
                    {label}
                  </button>
                ))}
              </div>
              <small>
                Dá para gerar com um canal desconectado; ele só envia depois que
                você conectar.
              </small>
              <div>
                <p className="field-label">Tom</p>
                <div className="row wrap">
                  {["Pessoal", "Direto", "Leve", "Formal"].map((t) => (
                    <button
                      className={`pill ${brief.tone === t ? "selected" : ""}`}
                      key={t}
                      aria-pressed={brief.tone === t}
                      onClick={() => setBrief({ ...brief, tone: t })}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="field-label">Ritmo</p>
                <div className="row wrap">
                  {[
                    ["Curta", "até 7 dias"],
                    ["Padrão", "10 a 14 dias"],
                    ["Longa", "3 semanas"],
                  ].map(([t, desc]) => (
                    <button
                      className={`pill ${brief.rhythm === t ? "selected" : ""}`}
                      key={t}
                      aria-pressed={brief.rhythm === t}
                      onClick={() => setBrief({ ...brief, rhythm: t })}
                    >
                      {t}
                      <small>· {desc}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="field-grid">
                <Field label="Destacar (opcional)">
                  <textarea
                    value={brief.highlight}
                    onChange={(e) =>
                      setBrief({ ...brief, highlight: e.target.value })
                    }
                    placeholder="O que precisa aparecer nas mensagens"
                  />
                </Field>
                <Field label="Evitar (opcional)">
                  <textarea
                    value={brief.avoid}
                    onChange={(e) =>
                      setBrief({ ...brief, avoid: e.target.value })
                    }
                    placeholder="Palavras, promessas ou assuntos a evitar"
                  />
                </Field>
              </div>
            </section>
            <div className="form-actions">
              <Button
                variant="primary"
                icon="Sparkles"
                disabled={!brief.channels.length || !brief.listId}
                onClick={generate}
              >
                Gerar opções com IA
              </Button>
            </div>
            <p className="demo-footnote">
              Demonstração: usa modelos locais editáveis. A integração com IA
              real está pendente.
            </p>
          </div>
          <aside className="aside-info">
            <h3>O que a IA vai escrever</h3>
            <p>
              <strong>Três réguas inteiras,</strong> com os toques já escritos:
              dia, canal, assunto e mensagem.
            </p>
            <p>
              <strong>Escritas pra sua empresa,</strong> usando seu contexto.
            </p>
            <p>
              <strong>Você escolhe uma,</strong> edita texto por texto e só
              então ela nasce como rascunho.
            </p>
            <footer>
              Quanto mais específico o Destacar e o Evitar, menos genérico sai o
              texto.
            </footer>
          </aside>
        </div>
      ) : step === 1 ? (
        <>
          <div className="proposal-grid">
            {opts.map((c, i) => (
              <section className="panel proposal-card" key={c.id}>
                <Badge tone="orange">Opção {i + 1}</Badge>
                <h2 className="section-gap">{c.name.split(" · ")[0]}</h2>
                <p>
                  Uma sequência de {c.steps.length} contatos para{" "}
                  {brief.objective.toLowerCase()}, com tom{" "}
                  {brief.tone.toLowerCase()}.
                </p>
                <div className="cadence-option-steps">
                  {c.steps.map((st, j) => (
                    <div key={st.id}>
                      <span className="badge">
                        Dia{" "}
                        {c.steps
                          .slice(0, j + 1)
                          .reduce((n, x) => n + x.delayDays, 0)}
                      </span>
                      <Icon
                        name={st.channel === "EMAIL" ? "Mail" : "MessageSquare"}
                        size={15}
                      />
                      <p>{st.body}</p>
                    </div>
                  ))}
                </div>
                <Button
                  variant="primary"
                  onClick={() => {
                    setChosen(structuredClone(c));
                    setStep(2);
                  }}
                >
                  Escolher e revisar <Icon name="ArrowRight" size={16} />
                </Button>
              </section>
            ))}
          </div>
          <div className="form-actions">
            <Button onClick={() => setStep(0)}>Voltar</Button>
          </div>
        </>
      ) : chosen ? (
        <div className="workspace-form">
          <div>
            <section className="panel panel-pad stack">
              <Field label="Nome da cadência">
                <input
                  required
                  value={chosen.name}
                  onChange={(e) =>
                    setChosen({ ...chosen, name: e.target.value })
                  }
                />
              </Field>
              <Notice>
                Nada será enviado. A cadência será salva como rascunho na lista
                escolhida.
              </Notice>
              {chosen.steps.map((st, i) => (
                <section key={st.id} className="review-step">
                  <div className="row between">
                    <h3>
                      {i + 1}. {st.channel === "EMAIL" ? "E-mail" : "WhatsApp"}
                    </h3>
                    <Field label="Dias de espera">
                      <input
                        type="number"
                        min="0"
                        value={st.delayDays}
                        onChange={(e) =>
                          setChosen({
                            ...chosen,
                            steps: chosen.steps.map((x, j) =>
                              j === i
                                ? { ...x, delayDays: Number(e.target.value) }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                  </div>
                  {st.channel === "EMAIL" && (
                    <Field label="Assunto">
                      <input
                        value={st.subject ?? ""}
                        onChange={(e) =>
                          setChosen({
                            ...chosen,
                            steps: chosen.steps.map((x, j) =>
                              j === i ? { ...x, subject: e.target.value } : x,
                            ),
                          })
                        }
                      />
                    </Field>
                  )}
                  <Field label={`Mensagem ${i + 1}`}>
                    <textarea
                      rows={5}
                      value={st.body}
                      onChange={(e) =>
                        setChosen({
                          ...chosen,
                          steps: chosen.steps.map((x, j) =>
                            j === i ? { ...x, body: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </Field>
                </section>
              ))}
            </section>
            {issues.length > 0 && (
              <Notice tone="error">
                {issues.map((x) => (
                  <p key={x}>{x}</p>
                ))}
              </Notice>
            )}
            <div className="form-actions">
              <Button onClick={() => setStep(1)}>Voltar às opções</Button>
              <Button variant="primary" icon="Save" onClick={save}>
                Criar como rascunho
              </Button>
            </div>
          </div>
          <aside className="aside-info">
            <h3>Revisar e criar</h3>
            <p>
              Lista:{" "}
              <strong>
                {s.lists.find((l) => l.id === chosen.listId)?.name}
              </strong>
            </p>
            <p>
              Confira o texto de cada etapa. As variáveis serão substituídas
              pelos dados do lead.
            </p>
            <footer>
              Você ainda pode ajustar canais, horários e pausas no editor antes
              de ativar.
            </footer>
          </aside>
        </div>
      ) : null}
    </>
  );
}
