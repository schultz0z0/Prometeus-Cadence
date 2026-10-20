"use client";
import Link from "next/link";
import { useState } from "react";
import { useDemo, useRepository, useAction, useNotify } from "@/demo/provider";
import {
  createGenerationIdentity,
  prepareSimulatedGeneration,
} from "@/demo/prospecting";
import type { Source, Lead } from "@/domain/model";
import { SourcePicker } from "./source-picker";
import { CnpjFilters } from "./cnpj-filters";
import {
  Button,
  Field,
  PageHeader,
  Notice,
  Modal,
  LinkButton,
} from "@/components/ui/primitives";
export function Generator({
  initialSource = "MAPS",
}: {
  initialSource?: string;
}) {
  const s = useDemo();
  const repo = useRepository();
  const run = useAction();
  const notify = useNotify();
  const [source, setSource] = useState<Source>(
    ["MAPS", "WEB", "CNPJ", "APOLLO"].includes(initialSource)
      ? (initialSource as Source)
      : "MAPS",
  );
  const [mode, setMode] = useState("new");
  const [name, setName] = useState("");
  const [listId, setListId] = useState(s.lists[0]?.id ?? "");
  const [filters, setFilters] = useState<Record<string, string>>({
    term: "",
    location: "",
  });
  const [limit, setLimit] = useState(10);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{
    listId: string;
    count: number;
  } | null>(null);
  const [saved, setSaved] = useState<Record<string, string>[]>([]);
  const [cnpjMode, setCnpjMode] = useState("term");
  const [operation, setOperation] = useState(createGenerationIdentity);
  async function generate() {
    const id = mode === "new" ? operation.listId : listId;
    const r = prepareSimulatedGeneration(
      {
        source: source as "MAPS" | "WEB" | "CNPJ" | "APOLLO",
        destination: id,
        filters,
        limit,
      },
      mode === "new" ? name.trim() : undefined,
      operation,
    );
    if (
      await run(async () => {
        await repo.saveLeadBatch(r.leads, {
          mode: "import",
          ...(r.list ? { list: r.list } : {}),
          job: r.job,
        });
      }, "Simulação local concluída.")
    ) {
      setResult({ listId: id, count: r.leads.length });
      setConfirm(false);
      setOperation(createGenerationIdentity());
    }
  }
  return (
    <>
      <PageHeader
        title="Gerador de leads"
        description="Encontre empresas no Google Maps, na busca da web ou na Base CNPJ e salve numa lista pronta pra qualificar."
      />
      <div className="one-time-note">
        Isto roda uma vez, agora.{" "}
        <Link href="/automations/new/ai">
          Para ter leads entrando sozinho, crie uma automação <span>→</span>
        </Link>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setConfirm(true);
        }}
      >
        <p className="field-label">Fonte de busca</p>
        <SourcePicker value={source} onChange={setSource} />
        {source === "APOLLO" ? (
          <div className="panel panel-pad section-gap">
            <h3>Conecte sua conta Apollo</h3>
            <p className="secondary-text section-gap">
              A busca real exige uma integração e sua própria conta. Nenhuma
              chave é solicitada nesta demonstração.
            </p>
            <div className="section-gap">
              <LinkButton href="/settings/apps" variant="primary">
                Abrir CRM e apps
              </LinkButton>
            </div>
          </div>
        ) : (
          <div className="panel panel-pad section-gap stack">
            <div>
              <p className="field-label">Lista de destino</p>
              <div className="row">
                <Button
                  type="button"
                  variant={mode === "new" ? "soft" : ""}
                  onClick={() => setMode("new")}
                >
                  Criar nova
                </Button>
                <Button
                  type="button"
                  variant={mode === "existing" ? "soft" : ""}
                  onClick={() => setMode("existing")}
                >
                  Usar existente
                </Button>
              </div>
              <div className="section-gap">
                {mode === "new" ? (
                  <Field label="Nome da lista">
                    <input
                      required
                      placeholder="Ex.: Dentistas SP"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>
                ) : (
                  <Field label="Lista existente">
                    <select
                      required
                      value={listId}
                      onChange={(e) => setListId(e.target.value)}
                    >
                      {s.lists.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>
            </div>
            <div className="field-grid">
              <Field
                label={
                  source === "CNPJ"
                    ? "Termo de busca / CNAE"
                    : "Palavra-chave / Nicho"
                }
              >
                <div className="row">
                  <input
                    required
                    value={filters.term}
                    onChange={(e) =>
                      setFilters({ ...filters, term: e.target.value })
                    }
                    placeholder={
                      cnpjMode === "cnae"
                        ? "Ex.: 6920601"
                        : "Ex.: clínicas de estética"
                    }
                  />
                  <Button
                    type="button"
                    icon="Sparkles"
                    onClick={() => {
                      setFilters({
                        ...filters,
                        term: "Escritórios de contabilidade",
                      });
                      notify(
                        "Exemplo local aplicado. Nenhum modelo de IA foi consultado.",
                      );
                    }}
                  >
                    Sugerir
                  </Button>
                </div>
              </Field>
              <Field label="Localização">
                <input
                  required={source !== "CNPJ"}
                  value={filters.location}
                  onChange={(e) =>
                    setFilters({ ...filters, location: e.target.value })
                  }
                  placeholder="Ex.: São Paulo, SP"
                />
              </Field>
            </div>
            {source === "CNPJ" && (
              <>
                <div className="row">
                  <Button
                    type="button"
                    variant={cnpjMode === "term" ? "soft" : ""}
                    onClick={() => setCnpjMode("term")}
                  >
                    Por termo
                  </Button>
                  <Button
                    type="button"
                    variant={cnpjMode === "cnae" ? "soft" : ""}
                    onClick={() => setCnpjMode("cnae")}
                  >
                    Por CNAE
                  </Button>
                  <Button
                    type="button"
                    icon="Save"
                    onClick={() => {
                      setSaved([...saved, filters]);
                      notify("Pesquisa salva nesta sessão.");
                    }}
                  >
                    Salvar pesquisa
                  </Button>
                </div>
                {saved.length > 0 && (
                  <div className="row wrap">
                    {saved.map((f, i) => (
                      <Button
                        key={i}
                        type="button"
                        onClick={() => setFilters(f)}
                      >
                        {f.term || `Pesquisa ${i + 1}`}
                      </Button>
                    ))}
                  </div>
                )}
                <CnpjFilters value={filters} onChange={setFilters} />
              </>
            )}
            <Field
              label="Máximo de resultados na simulação"
              help="De 1 a 20 exemplos fictícios, sem gasto de créditos."
            >
              <input
                type="number"
                min="1"
                max="20"
                required
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              />
            </Field>
            <Notice>
              Os leads entram sem qualificação. Rode o Qualificador depois para
              revisar o perfil.
            </Notice>
            <div className="form-actions">
              <Button variant="primary" icon="Play" type="submit">
                Preparar demonstração local
              </Button>
            </div>
          </div>
        )}
      </form>
      {result && (
        <div className="notice success section-gap">
          <div>
            <h3>{result.count} exemplos salvos</h3>
            <p>Nenhuma busca externa foi executada.</p>
            <LinkButton href={`/contacts?list=${result.listId}`}>
              Ver lista
            </LinkButton>
          </div>
        </div>
      )}
      {confirm && (
        <Modal title="Gerar exemplos locais?" onClose={() => setConfirm(false)}>
          <p>
            Serão criados até {limit} contatos fictícios na lista{" "}
            <strong>
              {name || s.lists.find((l) => l.id === listId)?.name}
            </strong>
            . Isso não consulta{" "}
            {source === "CNPJ" ? "a Receita Federal" : "fontes externas"} nem
            consome créditos.
          </p>
          <div className="form-actions">
            <Button onClick={() => setConfirm(false)}>Cancelar</Button>
            <Button variant="primary" onClick={generate}>
              Confirmar simulação
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
