"use client";
import { useState } from "react";
import { useDemo } from "@/demo/provider";
import type { CadenceStep, Channel } from "@/domain/model";
import { renderStepPreview } from "@/domain/cadence";
import {useIdentity} from '@/client/workspace-provider';
import {MessagePreview} from '@/modules/planning/message-preview';
import {
  Button,
  Field,
  Modal,
  Toggle,
  Notice,
} from "@/components/ui/primitives";
export function StepEditor({
  step,
  index,
  total,
  listId,
  cadenceId,
  pending = false,
  onSave,
  onDelete,
  onMove,
  onClose,
}: {
  step: CadenceStep;
  index: number;
  total: number;
  listId: string;
  cadenceId?: string;
  pending?: boolean;
  onSave: (s: CadenceStep) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1, edited: CadenceStep) => void;
  onClose: () => void;
}) {
  const s = useDemo();
  const identity=useIdentity();
  const [d, setD] = useState(structuredClone(step));
  const leads = s.leads.filter((l) => l.listId === listId);
  const [leadId, setLeadId] = useState(leads[0]?.id ?? "");
  const lead = leads.find((l) => l.id === leadId);
  const preview = lead ? renderStepPreview(d, lead) : null;
  return (
    <Modal
      wide
      title={`Etapa ${index + 1} · ${d.channel === "EMAIL" ? "E-mail" : d.channel === "LINKEDIN" ? "LinkedIn" : "WhatsApp"}`}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(d);
        }}
      >
        <div className="field-grid">
          <Field label="Canal">
            <select
              value={d.channel}
              onChange={(e) =>
                setD({ ...d, channel: e.target.value as Channel })
              }
            >
              <option value="WHATSAPP">WhatsApp</option>
              <option value="EMAIL">E-mail</option>
              <option value="LINKEDIN">LinkedIn</option>
            </select>
          </Field>
          <Field label="Dias de espera">
            <input
              type="number"
              min="0"
              required
              value={d.delayDays}
              onChange={(e) =>
                setD({ ...d, delayDays: Number(e.target.value) })
              }
            />
          </Field>
        </div>
        <div className="stack section-gap">
          {d.channel==='WHATSAPP'&&<Notice>Este é o texto do rascunho. O template aprovado e suas variáveis serão vinculados na revisão de publicação da cadência.</Notice>}
          {d.channel === "EMAIL" && (
            <Field label="Assunto">
              <input
                value={d.subject ?? ""}
                onChange={(e) => setD({ ...d, subject: e.target.value })}
              />
            </Field>
          )}
          {s.templates.some((t) => t.channel === d.channel) && (
            <Field label="Usar template">
              <select
                defaultValue=""
                onChange={(e) => {
                  const t = s.templates.find((t) => t.id === e.target.value);
                  if (t) setD({ ...d, subject: t.subject, body: t.body });
                }}
              >
                <option value="">Escolha um template</option>
                {s.templates
                  .filter((t) => t.channel === d.channel)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          <Field label="Mensagem *">
            <textarea
              rows={6}
              required
              autoFocus
              value={d.body}
              onChange={(e) => setD({ ...d, body: e.target.value })}
            />
          </Field>
          <div className="row wrap">
            <small>Inserir:</small>
            {[
              "nome",
              "email",
              "telefone",
              "site",
              "cidade",
              "razaoSocial",
              "cnpj",
            ].map((v) => (
              <button
                className="token-button"
                type="button"
                key={v}
                onClick={() => setD({ ...d, body: d.body + "{{" + v + "}}" })}
              >
                {"{{" + v + "}}"}
              </button>
            ))}
          </div>
          <Field label="Instruções para personalização com IA (opcional)">
            <textarea
              value={d.aiInstructions ?? ""}
              onChange={(e) => setD({ ...d, aiInstructions: e.target.value })}
              placeholder="Ex.: mencione o site do lead, mantenha o tom pessoal…"
            />
          </Field>
          <Toggle
            label="Sair se o lead responder"
            checked={d.stopOnReply}
            onChange={(v) => setD({ ...d, stopOnReply: v })}
          />
          <section className="panel panel-pad">
            <h3>Prévia com lead real da lista</h3>
            <select
              aria-label="Lead para prévia"
              className="section-gap"
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
            >
              {leads.map((l) => (
                <option value={l.id} key={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            {d.channel === "EMAIL" && preview?.subject && (
              <h4>{preview.subject}</h4>
            )}
            <p className="message-preview">
              {preview?.text || "Nenhum lead disponível."}
            </p>
            {preview?.unresolved.length ? (
              <Notice>
                Variáveis sem valor: {preview.unresolved.join(", ")}. Revise
                antes de usar.
              </Notice>
            ) : null}
          </section>
        </div>
        <div className="step-actions">
          <div className="row">
            <Button
              type="button"
              variant="danger"
              icon="Trash2"
              onClick={onDelete}
            >
              Remover etapa
            </Button>
            <Button
              type="button"
              disabled={pending || index === 0}
              onClick={() => onMove(-1, d)}
            >
              Subir
            </Button>
            <Button
              type="button"
              disabled={pending || index === total - 1}
              onClick={() => onMove(1, d)}
            >
              Descer
            </Button>
          </div>
          <div className="row">
            <Button type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary">
              Aplicar à sequência
            </Button>
          </div>
        </div>
      </form>
      {identity&&cadenceId&&!pending&&lead&&<MessagePreview key={lead.id+step.id} cadenceId={cadenceId} step={d} lead={lead} onAccept={setD}/>}
    </Modal>
  );
}
