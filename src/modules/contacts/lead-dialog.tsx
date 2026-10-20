"use client";
import { useState } from "react";
import { useDemo, useRepository, useAction } from "@/demo/provider";
import { Button, Field, Modal } from "@/components/ui/primitives";
import type { Lead } from "@/domain/model";
export function LeadDialog({
  lead,
  onClose,
}: {
  lead?: Lead;
  onClose: () => void;
}) {
  const s = useDemo();
  const repo = useRepository();
  const run = useAction();
  const [newListId] = useState(() => crypto.randomUUID());
  const [newListName, setNewListName] = useState("Meus primeiros contatos");
  const [d, setD] = useState<Lead>(
    lead ?? {
      id: crypto.randomUUID(),
      name: "",
      listId: s.lists[0]?.id ?? "",
      source: "MANUAL",
      qualification: "pending",
      createdAt: new Date().toISOString(),
    },
  );
  function field(k: keyof Lead, v: string) {
    setD({ ...d, [k]: v });
  }
  return (
    <Modal
      title={lead ? "Editar contato" : "Adicionar contato"}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await run(async () => {
              if (!s.lists.length)
                await repo.importLeads(
                  [{ ...d, name: d.name.trim(), listId: newListId }],
                  { id: newListId, name: newListName },
                );
              else await repo.upsertLead({ ...d, name: d.name.trim() });
            }, "Contato salvo.")
          )
            onClose();
        }}
      >
        <div className="stack">
          <Field label="Nome da empresa *">
            <input
              autoFocus
              value={d.name}
              onChange={(e) => field("name", e.target.value)}
              required
              maxLength={180}
            />
          </Field>
          {!s.lists.length ? (
            <Field label="Nome da nova lista">
              <input
                required
                maxLength={100}
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
              />
            </Field>
          ) : (
            <Field label="Lista">
              <select
                value={d.listId}
                onChange={(e) => field("listId", e.target.value)}
                required
              >
                {s.lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="field-grid">
            {[
              ["email", "E-mail"],
              ["phone", "Telefone"],
              ["site", "Site"],
              ["city", "Cidade"],
              ["state", "Estado / UF"],
              ["cnpj", "CNPJ"],
            ].map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  type={key === "email" ? "email" : "text"}
                  value={String(d[key as keyof Lead] ?? "")}
                  onChange={(e) => field(key as keyof Lead, e.target.value)}
                />
              </Field>
            ))}
          </div>
          <Field label="Qualificação">
            <select
              value={d.qualification}
              onChange={(e) => field("qualification", e.target.value)}
            >
              <option value="pending">Pendente</option>
              <option value="qualified">Qualificado</option>
              <option value="warning">Em alerta</option>
              <option value="disqualified">Desqualificado</option>
            </select>
          </Field>
        </div>
        <div className="form-actions">
          <Button type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit">
            Salvar contato
          </Button>
        </div>
      </form>
    </Modal>
  );
}
