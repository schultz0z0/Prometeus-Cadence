"use client";
import { useRef, useState } from "react";
import { useDemo } from "@/demo/provider";
import type { Cadence, CadenceStep, Channel } from "@/domain/model";
import { renderStepPreview, moveCadenceStep } from "@/domain/cadence";
import { Icon } from "@/components/ui/icon";
import {
  Button,
  IconButton,
  Modal,
  Notice,
  Field,
} from "@/components/ui/primitives";
import { StepEditor } from "./step-editor";
export function SequenceCanvas({
  cadence,
  onChange,
  onSettings,
}: {
  cadence: Cadence;
  onChange: (c: Cadence) => void;
  onSettings: () => void;
}) {
  const s = useDemo();
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    step: CadenceStep;
    index: number;
  } | null>(null);
  const [add, setAdd] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [preview, setPreview] = useState(false);
  const [leadId, setLeadId] = useState(
    s.leads.find((l) => l.listId === cadence.listId)?.id ?? "",
  );
  const [remove, setRemove] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const current =
    pending?.step ?? cadence.steps.find((st) => st.id === editing);
  const index =
    pending?.index ?? cadence.steps.findIndex((st) => st.id === editing);
  const lead = s.leads.find((l) => l.id === leadId);
  const count = s.leads.filter((l) => l.listId === cadence.listId).length;
  function update(step: CadenceStep) {
    const steps = [...cadence.steps];
    if (pending) steps.splice(pending.index, 0, step);
    onChange({
      ...cadence,
      steps: pending
        ? steps
        : cadence.steps.map((st) => (st.id === step.id ? step : st)),
    });
    setPending(null);
    setEditing(null);
  }
  function append(channel: Channel) {
    const id = crypto.randomUUID();
    setPending({
      index: add ?? cadence.steps.length,
      step: {
        id,
        channel,
        delayDays: 1,
        subject: channel === "EMAIL" ? "" : "",
        body: "",
        stopOnReply: true,
      },
    });
    setAdd(null);
    setEditing(id);
  }
  function move(direction: -1 | 1, edited: CadenceStep) {
    onChange(moveCadenceStep(cadence, edited, direction));
    setEditing(null);
  }
  return (
    <div className="canvas-region">
      <div className="sequence-canvas" ref={canvas}>
        <div
          className="sequence-flow"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top center",
            paddingBottom: 100,
          }}
        >
          <button className="flow-entry" onClick={onSettings}>
            <span className="entry-icon">
              <Icon name="Workflow" size={19} />
            </span>
            <span>
              <strong>
                {s.lists.find((l) => l.id === cadence.listId)?.name ||
                  "Escolha uma lista"}
              </strong>
              <small>
                {count} leads · Seg–Sex · {cadence.settings.sendTime}
              </small>
            </span>
          </button>
          {cadence.steps.map((st, i) => (
            <div className="flow-segment" key={st.id}>
              <div className="flow-connector">
                <button
                  aria-label={`Adicionar etapa antes da ${i + 1}`}
                  onClick={() => setAdd(i)}
                >
                  <Icon name="Plus" size={13} />
                </button>
              </div>
              <div className="delay-pill">
                <Icon name="Clock" size={13} />
                <input
                  type="number"
                  min="0"
                  aria-label={`Dias de espera antes da etapa ${i + 1}`}
                  value={st.delayDays}
                  onChange={(e) =>
                    onChange({
                      ...cadence,
                      steps: cadence.steps.map((x, j) =>
                        i === j
                          ? { ...x, delayDays: Number(e.target.value) }
                          : x,
                      ),
                    })
                  }
                />
                <span>{st.delayDays === 1 ? "dia" : "dias"}</span>
              </div>
              {i > 0 && (
                <button
                  className="stop-reply"
                  onClick={() =>
                    onChange({
                      ...cadence,
                      steps: cadence.steps.map((x, j) =>
                        i === j ? { ...x, stopOnReply: !x.stopOnReply } : x,
                      ),
                    })
                  }
                >
                  <Icon name="ArrowRight" size={11} />
                  {st.stopOnReply
                    ? "sai se responder"
                    : "continua após resposta"}
                </button>
              )}
              <div className="flow-connector short" />
              <button
                className={`message-node ${st.channel.toLowerCase()}`}
                onClick={() => setEditing(st.id)}
              >
                <span className="channel-icon">
                  <Icon
                    name={
                      st.channel === "EMAIL"
                        ? "Mail"
                        : st.channel === "LINKEDIN"
                          ? "Linkedin"
                          : "MessageSquare"
                    }
                    size={17}
                  />
                </span>
                <span className="node-text">
                  <small>
                    {i + 1} ·{" "}
                    {st.channel === "EMAIL"
                      ? "E-MAIL"
                      : st.channel === "LINKEDIN"
                        ? "LINKEDIN"
                        : "WHATSAPP"}
                  </small>
                  <p>{st.body || "Escrever mensagem…"}</p>
                </span>
                <Icon name="Sparkles" className="orange" size={13} />
              </button>
            </div>
          ))}
          <div className="flow-connector">
            <button
              aria-label="Adicionar etapa no final"
              onClick={() => setAdd(cadence.steps.length)}
            >
              <Icon name="Plus" size={13} />
            </button>
          </div>
          <button className="flow-exit" onClick={onSettings}>
            <Icon name="Flag" size={12} />
            Saída
          </button>
        </div>
      </div>
      <button
        className="minimap"
        title="Ir para o início da sequência"
        aria-label="Minimapa do fluxo"
        onClick={() => canvas.current?.scrollTo({ top: 0, behavior: "smooth" })}
      >
        <div className="minimap-entry" />
        {cadence.steps.map((st) => (
          <div key={st.id} className="minimap-node">
            <span />
            {st.channel === "EMAIL" ? "E-mail" : "WhatsApp"}
          </div>
        ))}
        <div className="minimap-exit">Saída</div>
      </button>
      <div className="canvas-controls">
        <Button variant="ghost" icon="Eye" onClick={() => setPreview(true)}>
          Prévia
        </Button>
        <span className="control-separator" />
        <IconButton
          icon="ZoomOut"
          label="Diminuir zoom"
          onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
        />
        <span>{Math.round(zoom * 100)}%</span>
        <IconButton
          icon="ZoomIn"
          label="Aumentar zoom"
          onClick={() => setZoom(Math.min(1.5, zoom + 0.1))}
        />
        <IconButton
          icon="Maximize2"
          label="Zoom 100%"
          onClick={() => setZoom(1)}
        />
      </div>
      {add !== null && (
        <Modal title="Adicionar etapa" onClose={() => setAdd(null)}>
          <div className="stack">
            {(
              [
                ["WHATSAPP", "WhatsApp", "MessageSquare"],
                ["EMAIL", "E-mail", "Mail"],
                ["LINKEDIN", "LinkedIn", "Linkedin"],
              ] as const
            ).map(([channel, title, icon]) => (
              <Button key={channel} icon={icon} onClick={() => append(channel)}>
                {title}
              </Button>
            ))}
          </div>
        </Modal>
      )}
      {current && (
        <StepEditor
          key={current.id}
          step={current}
          index={index}
          total={cadence.steps.length}
          listId={cadence.listId}
          pending={!!pending}
          onSave={update}
          onMove={move}
          onDelete={() =>
            pending ? (setPending(null), setEditing(null)) : setRemove(true)
          }
          onClose={() => {
            setPending(null);
            setEditing(null);
          }}
        />
      )}
      {remove && (
        <Modal title="Remover etapa?" onClose={() => setRemove(false)}>
          <p>
            Você pode cancelar as alterações recarregando a cadência antes de
            salvar.
          </p>
          <div className="form-actions">
            <Button onClick={() => setRemove(false)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => {
                onChange({
                  ...cadence,
                  steps: cadence.steps.filter((st) => st.id !== editing),
                });
                setRemove(false);
                setEditing(null);
              }}
            >
              Remover etapa
            </Button>
          </div>
        </Modal>
      )}
      {preview && (
        <Modal
          title="Prévia da cadência"
          onClose={() => setPreview(false)}
          wide
        >
          <Field label="Lead da lista">
            <select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">Selecione um lead</option>
              {s.leads
                .filter((l) => l.listId === cadence.listId)
                .map((l) => (
                  <option value={l.id} key={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </Field>
          {!lead && (
            <div className="notice section-gap">
              A lista ainda não tem contatos para uma prévia personalizada.
            </div>
          )}
          {cadence.steps.map((st, i) => {
            const r = lead
              ? renderStepPreview(st, lead)
              : { text: st.body, subject: st.subject, unresolved: [] };
            return (
              <section key={st.id} className="preview-message">
                <small>
                  {i + 1} · {st.channel} · após {st.delayDays} dias
                </small>
                {st.subject && <h3>{r.subject}</h3>}
                <p>{r.text}</p>
                {r.unresolved.length > 0 && (
                  <Notice>Sem valor: {r.unresolved.join(", ")}</Notice>
                )}
              </section>
            );
          })}
        </Modal>
      )}
    </div>
  );
}
