"use client";
import { useDemo } from "@/demo/provider";
import type { Cadence, Qualification } from "@/domain/model";
import { qualificationLabels } from "@/domain/model";
import { Field, Toggle, Notice } from "@/components/ui/primitives";
export function CadenceSettings({
  cadence,
  onChange,
}: {
  cadence: Cadence;
  onChange: (c: Cadence) => void;
}) {
  const s = useDemo();
  const cfg = cadence.settings;
  const set = (values: Partial<typeof cfg>) =>
    onChange({ ...cadence, settings: { ...cfg, ...values } });
  return (
    <div className="settings-form">
      <section className="panel panel-pad stack">
        <h2>Básico</h2>
        <Field label="Nome da cadência">
          <input
            value={cadence.name}
            onChange={(e) => onChange({ ...cadence, name: e.target.value })}
          />
        </Field>
        <Field label="Lista vinculada *">
          <select
            value={cadence.listId}
            onChange={(e) => onChange({ ...cadence, listId: e.target.value })}
          >
            {s.lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({s.leads.filter((x) => x.listId === l.id).length}{" "}
                leads)
              </option>
            ))}
          </select>
        </Field>
        <div>
          <p className="field-label">Quem entra</p>
          <div className="row wrap">
            {Object.entries(qualificationLabels).map(([v, label]) => (
              <button
                className={`pill ${cfg.acceptedQualifications.includes(v as Qualification) ? "selected" : ""}`}
                key={v}
                onClick={() =>
                  set({
                    acceptedQualifications: cfg.acceptedQualifications.includes(
                      v as Qualification,
                    )
                      ? cfg.acceptedQualifications.filter((x) => x !== v)
                      : [...cfg.acceptedQualifications, v as Qualification],
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
          <small>
            Quem ganhar um desses vereditos depois entra sozinho quando a régua
            estiver ativa.
          </small>
        </div>
      </section>
      <section className="panel panel-pad section-gap stack">
        <h2>Agendamento</h2>
        <div className="field-grid">
          <Field label="Hora">
            <input
              type="time"
              value={cfg.sendTime}
              onChange={(e) => set({ sendTime: e.target.value })}
            />
          </Field>
          <Field label="Fuso horário">
            <select
              value={cfg.timezone}
              onChange={(e) => set({ timezone: e.target.value })}
            >
              <option value="America/Sao_Paulo">Brasília (UTC−3)</option>
              <option value="America/Manaus">Manaus (UTC−4)</option>
              <option value="Europe/Lisbon">Lisboa</option>
            </select>
          </Field>
        </div>
        <div>
          <p className="field-label">Dias da semana</p>
          <div className="row wrap">
            {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d, i) => (
              <button
                key={d}
                className={`chip ${cfg.weekdays.includes(i) ? "selected" : ""}`}
                aria-pressed={cfg.weekdays.includes(i)}
                onClick={() =>
                  set({
                    weekdays: cfg.weekdays.includes(i)
                      ? cfg.weekdays.filter((x) => x !== i)
                      : [...cfg.weekdays, i],
                  })
                }
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <Toggle
          label="Pular feriados"
          description="Feriados nacionais."
          checked={cfg.skipHolidays}
          onChange={(v) => set({ skipHolidays: v })}
        />
        {(["intervalSeconds", "whatsappIntervalSeconds"] as const).map(
          (key) => (
            <div key={key}>
              <p className="field-label">
                {key === "intervalSeconds"
                  ? "Intervalo entre envios (segundos)"
                  : "Intervalo entre envios de WhatsApp (segundos)"}
              </p>
              <p className="muted small-note">
                {key === "intervalSeconds"
                  ? "Pausa aleatória entre um envio e outro."
                  : "Número próprio: intervalo conservador recomendado de 60–180 segundos."}
              </p>
              <div className="row section-gap">
                <Field label="Mínimo">
                  <input
                    type="number"
                    min="0"
                    value={cfg[key][0]}
                    onChange={(e) =>
                      set({ [key]: [Number(e.target.value), cfg[key][1]] })
                    }
                  />
                </Field>
                <span>—</span>
                <Field label="Máximo">
                  <input
                    type="number"
                    min="0"
                    value={cfg[key][1]}
                    onChange={(e) =>
                      set({ [key]: [cfg[key][0], Number(e.target.value)] })
                    }
                  />
                </Field>
              </div>
            </div>
          ),
        )}
        <Toggle
          label="Distribuir envios ao longo do dia"
          description="Distribui os leads em múltiplas janelas de horário."
          checked={cfg.distribute}
          onChange={(v) => set({ distribute: v })}
        />
        <Toggle
          label="Budget automático"
          description="Divide a capacidade entre as cadências ativas do mesmo canal."
          checked={cfg.budgetPercent === null}
          onChange={(v) => set({ budgetPercent: v ? null : 50 })}
        />
        {cfg.budgetPercent !== null && (
          <Field label="Budget de WhatsApp (%)">
            <input
              type="number"
              min="1"
              max="100"
              value={cfg.budgetPercent}
              onChange={(e) => set({ budgetPercent: Number(e.target.value) })}
            />
          </Field>
        )}
      </section>
      <section className="panel panel-pad section-gap">
        <h2>WhatsApp</h2>
        <p className="secondary-text section-gap">
          Por qual conexão saem as etapas desta régua.
        </p>
        <div className="section-gap">
          <Notice>
            Nenhum número conectado. As mensagens de WhatsApp ficam esperando
            até a conexão do canal.
          </Notice>
        </div>
      </section>
      <section className="panel panel-pad section-gap stack">
        <h2>Pausas automáticas</h2>
        <p className="secondary-text">Quando a régua para sozinha.</p>
        <Toggle
          label="Parar o lead que responder"
          description="E-mail ou WhatsApp."
          checked={cfg.stopOnReply}
          onChange={(v) => set({ stopOnReply: v })}
        />
        <Toggle
          label="Só e-mail corporativo"
          description="E-mails pessoais pulam a etapa e seguem pelo próximo canal."
          checked={cfg.corporateOnly}
          onChange={(v) => set({ corporateOnly: v })}
        />
        <Toggle
          label="Não incluir quem já respondeu numa régua anterior"
          description="Resposta automática não conta como conexão."
          checked={cfg.excludeReplied}
          onChange={(v) => set({ excludeReplied: v })}
        />
        <Toggle
          label="Terminou sem resposta? Tentar outro contato do lead"
          checked={cfg.alternateContact}
          onChange={(v) => set({ alternateContact: v })}
        />
        <Toggle
          label="Reengajar quem terminar sem responder"
          description="Leva para outra lista quem concluiu sem resposta."
          checked={cfg.reengage}
          onChange={(v) => set({ reengage: v })}
        />
        <Field label="Palavras-chave de pausa" help="Uma por linha.">
          <textarea
            value={cfg.stopKeywords.join("\n")}
            onChange={(e) => set({ stopKeywords: e.target.value.split("\n") })}
          />
        </Field>
        <Toggle
          label="Pausar a régua por bounces no dia"
          description="O contador zera todo dia e a cada retomada."
          checked={cfg.pauseOnBounce}
          onChange={(v) => set({ pauseOnBounce: v })}
        />
        <div className="field-grid">
          <Field label="Pausar após (bounces/dia)">
            <input
              type="number"
              min="3"
              value={cfg.bounceLimit}
              onChange={(e) => set({ bounceLimit: Number(e.target.value) })}
            />
          </Field>
          <Field label="Retomar sozinha">
            <select
              value={cfg.resume}
              onChange={(e) =>
                set({ resume: e.target.value as typeof cfg.resume })
              }
            >
              <option value="tomorrow">no dia seguinte</option>
              <option value="hours">depois de algumas horas</option>
              <option value="manual">nunca, só quando eu reativar</option>
            </select>
          </Field>
        </div>
      </section>
    </div>
  );
}
