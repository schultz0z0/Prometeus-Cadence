"use client";
import { useMemo, useState } from "react";
import { parseContactImport, mapImportedContacts } from "@/domain/import";
import { useDemo, useRepository, useAction } from "@/demo/provider";
import { Button, Field, Modal, Notice } from "@/components/ui/primitives";
export function ImportPreview({ onClose }: { onClose: () => void }) {
  const s = useDemo();
  const repo = useRepository();
  const run = useAction();
  const [newListId] = useState(() => crypto.randomUUID()),
    [newListName, setNewListName] = useState("Contatos importados");
  const [text, setText] = useState("");
  const [listId, setListId] = useState(s.lists[0]?.id ?? "");
  const [step, setStep] = useState(0);
  const [map, setMap] = useState<
    Partial<
      Record<"name" | "email" | "phone" | "site" | "city" | "state", number>
    >
  >({ name: 0, email: 1, phone: 2 });
  const p = useMemo(() => parseContactImport(text), [text]);
  const destination = listId || newListId;
  const m = useMemo(
    () => mapImportedContacts(p, map, destination),
    [p, map, destination],
  );
  return (
    <Modal
      wide
      title="Importar planilha"
      description="CSV ou TXT, com mapeamento de colunas e prévia antes de salvar."
      onClose={onClose}
    >
      {step === 0 ? (
        <div className="stack">
          <Field label="Escolher arquivo">
            <input
              type="file"
              accept=".csv,.txt,.tsv"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  if (f.size > 5000000) {
                    alert("Use um arquivo de até 5 MB.");
                    return;
                  }
                  setText(await f.text());
                }
              }}
            />
          </Field>
          <Field label="Ou cole os dados">
            <textarea
              rows={7}
              placeholder={
                "Nome,E-mail,Telefone\nEmpresa exemplo,contato@empresa.example,11900000000"
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <Button
            variant="primary"
            disabled={!text.trim()}
            onClick={() => setStep(1)}
          >
            Mapear colunas
          </Button>
        </div>
      ) : (
        <>
          <div className="field-grid">
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
              <Field label="Lista de destino">
                <select
                  value={listId}
                  onChange={(e) => setListId(e.target.value)}
                >
                  {s.lists.map((l) => (
                    <option value={l.id} key={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {(
              [
                ["name", "Nome *"],
                ["email", "E-mail"],
                ["phone", "Telefone"],
                ["site", "Site"],
                ["city", "Cidade"],
                ["state", "Estado"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <select
                  value={map[key] ?? -1}
                  onChange={(e) =>
                    setMap({ ...map, [key]: Number(e.target.value) })
                  }
                >
                  <option value={-1}>Não importar</option>
                  {p.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <div className="import-summary">
            {m.leads.length} contatos válidos · {m.errors.length} erros
          </div>
          {m.errors.length > 0 && (
            <Notice tone="error">
              {m.errors.slice(0, 5).map((e, i) => (
                <p key={i}>
                  Linha {e.line}: {e.message}
                </p>
              ))}
            </Notice>
          )}
          <div className="table-scroll section-gap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Telefone</th>
                </tr>
              </thead>
              <tbody>
                {m.leads.slice(0, 5).map((l) => (
                  <tr key={l.id}>
                    <td>{l.name}</td>
                    <td>{l.email ?? "—"}</td>
                    <td>{l.phone ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <Button onClick={() => setStep(0)}>Voltar</Button>
            <Button
              variant="primary"
              disabled={
                !m.leads.length ||
                (!listId && !newListName.trim()) ||
                m.leads.length > 500 ||
                map.name === -1 ||
                p.errors.length > 0
              }
              onClick={async () => {
                if (
                  await run(
                    async () =>
                      await repo.importLeads(
                        m.leads,
                        !s.lists.length
                          ? { id: newListId, name: newListName }
                          : undefined,
                      ),
                    `${m.leads.length} contatos importados.`,
                  )
                )
                  onClose();
              }}
            >
              Confirmar importação
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
