"use client";
import Link from "next/link";
import { useState } from "react";
import { useDemo, useRepository, useAction } from "@/demo/provider";
import { useIdentity } from "@/client/workspace-provider";
import { filterLeads } from "@/domain/leads";
import {
  qualificationLabels,
  qualificationTones,
  type Qualification,
} from "@/domain/model";
import { Icon } from "@/components/ui/icon";
import {
  Badge,
  Button,
  IconButton,
  LinkButton,
  PageHeader,
  Modal,
  Field,
  EmptyState,
} from "@/components/ui/primitives";
import { LeadDialog } from "./lead-dialog";
import { ImportPreview } from "./import-preview";
export function ContactsTable({ initialList = "" }: { initialList?: string }) {
  const s = useDemo();
  const identity = useIdentity();
  const repo = useRepository();
  const run = useAction();
  const [query, setQuery] = useState("");
  const [list, setList] = useState(initialList);
  const [status, setStatus] = useState<Qualification | "">("");
  const [selection, setSelection] = useState<string[]>([]);
  const [add, setAdd] = useState(false);
  const [manual, setManual] = useState(false);
  const [importing, setImporting] = useState(false);
  const [columns, setColumns] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const [sort, setSort] = useState<"name" | "city" | "newest">("newest");
  const [favorite, setFavorite] = useState(false);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [bulk, setBulk] = useState(false);
  const filtered = filterLeads(s.leads, {
    search: query,
    listId: list,
    qualification: status,
    onlyFavorites: favorite,
    sort,
  });
  const rows = filtered.slice((page - 1) * 20, page * 20);
  const toggle = (id: string) =>
    setSelection((x) =>
      x.includes(id) ? x.filter((a) => a !== id) : [...x, id],
    );
  const visible = (key: string) => !hidden.includes(key);
  function download() {
    const lines = [
      ["Nome", "E-mail", "Telefone", "Cidade", "UF"],
      ...filtered.map((l) => [
        l.name,
        l.email ?? "",
        l.phone ?? "",
        l.city ?? "",
        l.state ?? "",
      ]),
    ].map((r) => r.map((x) => '"' + x.replaceAll('"', '""') + '"').join(","));
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + lines.join("\n")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "contatos.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <PageHeader
        title="Leads"
        actions={
          <>
            <span className="muted count-label">{s.leads.length}</span>
            <div className="dropdown-wrap">
              <Button
                variant="primary"
                icon="Plus"
                onClick={() => setAdd(!add)}
              >
                Adicionar <Icon name="ChevronDown" size={14} />
              </Button>
              {add && (
                <div className="dropdown">
                  <button
                    onClick={() => {
                      setImporting(true);
                      setAdd(false);
                    }}
                  >
                    <Icon name="Upload" />
                    <span>
                      Importar planilha
                      <small>CSV/TXT, com mapeamento de colunas</small>
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setManual(true);
                      setAdd(false);
                    }}
                  >
                    <Icon name="Plus" />
                    <span>
                      Digitar um a um<small>Nome, e-mail, telefone…</small>
                    </span>
                  </button>
                  <div className="menu-label">GERAR LEADS</div>
                  {[
                    [
                      "MapPin",
                      "Google Maps",
                      "Empresas por segmento e cidade",
                      "MAPS",
                    ],
                    [
                      "Globe",
                      "Busca na web",
                      "Busca aberta, extração por IA",
                      "WEB",
                    ],
                    [
                      "Database",
                      "Base CNPJ",
                      "Por CNAE, porte, região e abertura",
                      "CNPJ",
                    ],
                  ].map(([icon, name, sub, source]) => (
                    <Link
                      key={source}
                      href={`/leads/generator?source=${source}`}
                    >
                      <Icon name={icon} />
                      <span>
                        {name}
                        <small>{sub}</small>
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="dropdown-wrap">
              <IconButton
                icon="MoreVertical"
                label="Mais ações"
                onClick={() => setMore(!more)}
              />
              {more && (
                <div className="dropdown right">
                  <button
                    onClick={() => {
                      download();
                      setMore(false);
                    }}
                  >
                    <Icon name="Download" />
                    Exportar contatos filtrados
                  </button>
                  <button
                    onClick={() => {
                      setFavorite(!favorite);
                      setMore(false);
                    }}
                  >
                    <Icon name="Star" />
                    {favorite ? "Mostrar todos" : "Somente favoritos"}
                  </button>
                </div>
              )}
            </div>
          </>
        }
      />
      <div className="contacts-toolbar">
        <div className="row wrap">
          <select
            aria-label="Lista de contatos"
            value={list}
            onChange={(e) => {
              setList(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos os contatos</option>
            {s.lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar qualificação"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as Qualification | "");
              setPage(1);
            }}
          >
            <option value="">Adicionar filtro · Status</option>
            {Object.entries(qualificationLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <div className="input-icon">
            <Icon name="Search" size={15} />
            <input
              aria-label="Pesquisar"
              placeholder="Pesquisar"
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Button icon="SlidersHorizontal" onClick={() => setColumns(true)}>
            Colunas
          </Button>
        </div>
      </div>
      <div className="row between contacts-caption">
        <span>
          {filtered.length} contatos{favorite ? " · favoritos" : ""}
        </span>
        {selection.length > 0 ? (
          <Button variant="soft" onClick={() => setBulk(true)}>
            {selection.length} selecionados · Ações
          </Button>
        ) : (
          <small>
            {identity
              ? "Contatos do workspace"
              : "Dados fictícios de demonstração"}
          </small>
        )}
      </div>
      <div className="panel table-scroll">
        <table className="data-table contacts-data">
          <thead>
            <tr>
              <th className="check-col">
                <input
                  type="checkbox"
                  aria-label="Selecionar todos da página"
                  checked={
                    rows.length > 0 &&
                    rows.every((l) => selection.includes(l.id))
                  }
                  onChange={(e) =>
                    setSelection(
                      e.target.checked
                        ? Array.from(
                            new Set([...selection, ...rows.map((l) => l.id)]),
                          )
                        : selection.filter(
                            (id) => !rows.some((l) => l.id === id),
                          ),
                    )
                  }
                />
              </th>
              <th>
                <button onClick={() => setSort("name")}>
                  NOME <span>↕</span>
                </button>
              </th>
              {visible("contact") && <th>CONTATO</th>}
              {visible("status") && <th>STATUS</th>}
              {visible("cadence") && <th>CADÊNCIA</th>}
              {visible("city") && (
                <th>
                  <button onClick={() => setSort("city")}>
                    CIDADE / UF <span>↕</span>
                  </button>
                </th>
              )}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr
                key={l.id}
                className={selection.includes(l.id) ? "selected-row" : ""}
              >
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${l.name}`}
                    checked={selection.includes(l.id)}
                    onChange={() => toggle(l.id)}
                  />
                </td>
                <td>
                  <div className="lead-name">
                    <button
                      aria-label={l.favorite ? "Desfavoritar" : "Favoritar"}
                      className={`favorite ${l.favorite ? "is-favorite" : ""}`}
                      onClick={async () =>
                        await run(
                          async () =>
                            await repo.upsertLead({
                              ...l,
                              favorite: !l.favorite,
                            }),
                        )
                      }
                    >
                      <Icon name="Star" size={14} />
                    </button>
                    <div>
                      <Link href={`/leads/${l.id}`}>{l.name}</Link>
                      {l.site && <small>{l.site}</small>}
                    </div>
                  </div>
                </td>
                {visible("contact") && (
                  <td className="contact-cell">
                    {l.email && (
                      <span>
                        <Icon name="Mail" size={12} />
                        {l.email}
                      </span>
                    )}
                    {l.phone && (
                      <span>
                        <Icon name="Phone" size={12} />
                        {l.phone}
                      </span>
                    )}
                    {!l.email && !l.phone && <small>sem contato</small>}
                  </td>
                )}
                {visible("status") && (
                  <td>
                    <Badge tone={qualificationTones[l.qualification]}>
                      <Icon
                        name={
                          l.qualification === "qualified"
                            ? "CheckCircle2"
                            : l.qualification === "disqualified"
                              ? "XCircle"
                              : "Clock"
                        }
                        size={11}
                      />
                      {qualificationLabels[l.qualification]}
                    </Badge>
                  </td>
                )}
                {visible("cadence") && (
                  <td>
                    <Badge>Aguardando</Badge>
                  </td>
                )}
                {visible("city") && (
                  <td className="city-cell">
                    {[l.city, l.state].filter(Boolean).join(", ") || "—"}
                  </td>
                )}
                <td>
                  <Link
                    href={`/leads/${l.id}`}
                    className="open-lead"
                    aria-label={`Abrir ${l.name}`}
                  >
                    <Icon name="ChevronRight" size={16} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <EmptyState
            icon="Search"
            title="Nenhum contato encontrado"
            description="Tente outro nome ou remova os filtros."
          />
        )}
      </div>
      <div className="table-pagination">
        <small>
          {Math.min((page - 1) * 20 + 1, filtered.length)}–
          {Math.min(page * 20, filtered.length)} de {filtered.length}
        </small>
        <div className="row">
          <IconButton
            icon="ChevronLeft"
            label="Página anterior"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          />
          <span>{page}</span>
          <IconButton
            icon="ChevronRight"
            label="Próxima página"
            disabled={page * 20 >= filtered.length}
            onClick={() => setPage(page + 1)}
          />
        </div>
      </div>
      {manual && <LeadDialog onClose={() => setManual(false)} />}
      {importing && <ImportPreview onClose={() => setImporting(false)} />}
      {columns && (
        <Modal title="Colunas da tabela" onClose={() => setColumns(false)}>
          <div className="stack">
            {[
              ["contact", "Contato"],
              ["status", "Status"],
              ["cadence", "Cadência"],
              ["city", "Cidade / UF"],
            ].map(([key, label]) => (
              <label className="row" key={key}>
                <input
                  type="checkbox"
                  checked={!hidden.includes(key)}
                  onChange={(e) =>
                    setHidden(
                      e.target.checked
                        ? hidden.filter((h) => h !== key)
                        : [...hidden, key],
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </Modal>
      )}
      {bulk && (
        <Modal
          title={`${selection.length} contatos selecionados`}
          onClose={() => setBulk(false)}
        >
          <Field label="Mover para lista">
            <select
              defaultValue=""
              onChange={async (e) => {
                if (
                  e.target.value &&
                  (await run(
                    async () =>
                      await repo.saveLeadBatch(
                        s.leads
                          .filter((l) => selection.includes(l.id))
                          .map((l) => ({
                            ...l,
                            listId: e.target.value,
                          })),
                        { mode: "update" },
                      ),
                    "Contatos movidos.",
                  ))
                ) {
                  setBulk(false);
                  setSelection([]);
                }
              }}
            >
              <option value="">Escolher lista</option>
              {s.lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="spacer" />
          <Field label="Alterar qualificação">
            <select
              defaultValue=""
              onChange={async (e) => {
                if (
                  e.target.value &&
                  (await run(
                    async () =>
                      await repo.saveLeadBatch(
                        s.leads
                          .filter((l) => selection.includes(l.id))
                          .map((l) => ({
                            ...l,
                            qualification: e.target.value as Qualification,
                          })),
                        { mode: "update" },
                      ),
                    "Qualificação alterada.",
                  ))
                ) {
                  setBulk(false);
                  setSelection([]);
                }
              }}
            >
              <option value="">Escolher status</option>
              {Object.entries(qualificationLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
        </Modal>
      )}
    </>
  );
}
