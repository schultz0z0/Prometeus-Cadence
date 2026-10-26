"use client";
import Link from "next/link";
import { useEffect,useState } from "react";
import {useContacts} from '@/client/use-contacts';
import {collectContactExport,csvCell} from '@/client/contacts-export';
import {createWorkspaceTransport} from '@/client/workspace-transport';
import type {ContactsPage} from '@/domain/contacts-query';
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
  const [hidden, setHidden] = useState<string[]>(["source","created"]);
  const [sort, setSort] = useState<"name" | "city" | "newest">("newest");
  const [favorite, setFavorite] = useState(false);
  const [filterMenu,setFilterMenu]=useState(false);
  const [filterKind,setFilterKind]=useState('');
  const [contactFilter,setContactFilter]=useState('');
  const [stateFilter,setStateFilter]=useState('');
  const [sourceFilter,setSourceFilter]=useState('');
  const [createdFrom,setCreatedFrom]=useState(''),[createdTo,setCreatedTo]=useState(''),[cadenceFilter,setCadenceFilter]=useState(''),[replyFilter,setReplyFilter]=useState<''|'yes'|'no'>(''),[optOutFilter,setOptOutFilter]=useState<''|'yes'|'no'>('');
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [exclude,setExclude]=useState(false),[excludeText,setExcludeText]=useState(''),[excludeReview,setExcludeReview]=useState(false),[deleting,setDeleting]=useState(false);
  const excludeEmails=new Set(excludeText.split(/[\s,;]+/).map(v=>v.trim().toLowerCase()).filter(v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))),excluded=s.leads.filter(l=>l.email&&excludeEmails.has(l.email.trim().toLowerCase()));
  const filtered = filterLeads(s.leads, {
    search: query,
    listId: list,
    qualification: status,
    onlyFavorites: favorite,
    sort,
    contact:contactFilter as ''|'email'|'phone'|'none',state:stateFilter,source:sourceFilter,createdFrom,createdTo,
  });
  const remote=useContacts({search:query,listId:list,qualification:status,onlyFavorites:favorite,sort,contact:contactFilter as ''|'email'|'phone'|'none',state:stateFilter,source:sourceFilter,createdFrom:createdFrom||undefined,createdTo:createdTo||undefined,cadenceId:cadenceFilter,reply:replyFilter,optOut:optOutFilter,page,pageSize:20});
  const total=remote.enabled?remote.data?.total??0:filtered.length;
  const rows=remote.enabled?remote.data?.items??[]:filtered.slice((page-1)*20,page*20);
  useEffect(()=>{setSelection([]);setPage(1);},[query,list,status,favorite,sort,contactFilter,stateFilter,sourceFilter,createdFrom,createdTo,cadenceFilter,replyFilter,optOutFilter]);
  const toggle = (id: string) =>
    setSelection((x) =>
      x.includes(id) ? x.filter((a) => a !== id) : [...x, id],
    );
  const visible = (key: string) => !hidden.includes(key);
  async function download() {
    let exportRows=filtered;
    if(identity?.activeWorkspaceId){
      const transport=createWorkspaceTransport({workspaceId:identity.activeWorkspaceId});
      try{exportRows=await collectContactExport(async exportPage=>{
        const params=new URLSearchParams(Object.entries({search:query,listId:list,qualification:status,onlyFavorites:String(favorite),sort,contact:contactFilter,state:stateFilter,source:sourceFilter,createdFrom,createdTo,cadenceId:cadenceFilter,reply:replyFilter,optOut:optOutFilter,page:String(exportPage),pageSize:'100'}).filter(([,v])=>v!==''));
        return transport.request<ContactsPage>('/api/contacts?'+params);
      });}finally{transport.dispose();}
    }
    const lines = [
      ["Nome", "E-mail", "Telefone", "Cidade", "UF"],
      ...exportRows.map((l) => [
        l.name,
        l.email ?? "",
        l.phone ?? "",
        l.city ?? "",
        l.state ?? "",
      ]),
    ].map((r) => r.map(csvCell).join(","));
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
    <div className="contacts-reference">
      <PageHeader
        title={<><span>Leads</span><small className="count-label">{s.leads.length}</small></>}
        actions={
          <>
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
                      void run(download);
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
          <div className="dropdown-wrap contacts-filter-menu"><Button icon="ListFilter" aria-expanded={filterMenu} onClick={()=>setFilterMenu(!filterMenu)}>Adicionar filtro</Button>{filterMenu&&<div className="dropdown">{['Status','Cadência','Contato disponível','Resposta','Origem','Enriquecimento','Estado','Criado em','Favoritos','CRM','E-mail verificado','Opt-out'].map(t=><button key={t} disabled={['Enriquecimento','CRM','E-mail verificado'].includes(t)||!identity&&['Cadência','Resposta','Opt-out'].includes(t)} title={['Enriquecimento','CRM','E-mail verificado'].includes(t)?'Depende do módulo de qualificação ou integração correspondente.':undefined} onClick={()=>{if(t==='Favoritos'){setFavorite(!favorite);setPage(1);}else setFilterKind(t);setFilterMenu(false);}}>{t}</button>)}</div>}</div>
          {(filterKind==='Status'||status)&&<select
            aria-label="Filtrar qualificação"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as Qualification | "");
              setPage(1);
            }}
          >
            <option value="">Status · Todos</option>
            {Object.entries(qualificationLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>}
          {(filterKind==='Contato disponível'||contactFilter)&&<select aria-label="Contato disponível" value={contactFilter} onChange={e=>{setContactFilter(e.target.value);setPage(1);}}><option value="">Qualquer contato</option><option value="email">Com e-mail</option><option value="phone">Com telefone</option><option value="none">Sem e-mail e telefone</option></select>}
          {(filterKind==='Origem'||sourceFilter)&&<select aria-label="Origem" value={sourceFilter} onChange={e=>{setSourceFilter(e.target.value);setPage(1);}}><option value="">Todas as origens</option>{[...new Set(s.leads.map(l=>l.source))].map(x=><option key={x}>{x}</option>)}</select>}
          {(filterKind==='Estado'||stateFilter)&&<select aria-label="Estado" value={stateFilter} onChange={e=>{setStateFilter(e.target.value);setPage(1);}}><option value="">Todos os estados</option>{[...new Set(s.leads.map(l=>l.state).filter(Boolean))].map(x=><option key={x}>{x}</option>)}</select>}
          {(filterKind==='Criado em'||createdFrom||createdTo)&&<div className="row wrap"><Field label="Criado a partir de (UTC)"><input type="date" value={createdFrom} onChange={e=>setCreatedFrom(e.target.value)}/></Field><Field label="Criado até (UTC)"><input type="date" value={createdTo} onChange={e=>setCreatedTo(e.target.value)}/></Field></div>}
          {(filterKind==='Cadência'||cadenceFilter)&&<select aria-label="Filtrar cadência" value={cadenceFilter} onChange={e=>setCadenceFilter(e.target.value)}><option value="">Todas as cadências</option><option value="any">Com inscrição em cadência</option><option value="none">Sem inscrição em cadência</option>{s.cadences.filter(c=>!c.archived).map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select>}
          {(filterKind==='Resposta'||replyFilter)&&<select aria-label="Filtrar resposta" value={replyFilter} onChange={e=>setReplyFilter(e.target.value as typeof replyFilter)}><option value="">Qualquer resposta</option><option value="yes">Com resposta registrada</option><option value="no">Sem resposta registrada</option></select>}
          {(filterKind==='Opt-out'||optOutFilter)&&<select aria-label="Filtrar opt-out" value={optOutFilter} onChange={e=>setOptOutFilter(e.target.value as typeof optOutFilter)}><option value="">Qualquer opt-out</option><option value="yes">Com bloqueio registrado</option><option value="no">Sem bloqueio registrado</option></select>}
          {(status||contactFilter||stateFilter||sourceFilter||favorite||createdFrom||createdTo||cadenceFilter||replyFilter||optOutFilter)&&<Button variant="ghost" icon="X" onClick={()=>{setStatus('');setContactFilter('');setStateFilter('');setSourceFilter('');setFavorite(false);setCreatedFrom('');setCreatedTo('');setCadenceFilter('');setReplyFilter('');setOptOutFilter('');setFilterKind('');setPage(1);}}>Limpar filtros</Button>}
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
          <Button icon="MailX" onClick={()=>{setExclude(true);setExcludeReview(false);}}>Excluir por e-mail</Button>
          <Button icon="SlidersHorizontal" onClick={() => setColumns(true)}>
            Colunas
          </Button>
        </div>
      </div>
      <div className="row between contacts-caption">
        <span>
          {total} contatos{favorite ? " · favoritos" : ""}
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
      {remote.error&&<div role="alert" className="error-bar">{remote.error} <Button onClick={remote.refresh}>Tentar novamente</Button></div>}
      <div className="panel table-scroll" aria-busy={remote.loading}>
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
              {visible("source")&&<th>ORIGEM</th>}
              {visible("created")&&<th>CRIADO EM</th>}
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
                            {const current=repo.getSnapshot().leads.find(item=>item.id===l.id);if(!current)throw Error('O contato mudou. Atualize antes de continuar.');await repo.upsertLead({...current,favorite:!current.favorite});},
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
                    <Badge>{remote.enabled?({active:'Em andamento',stopped:'Interrompida',blocked:'Bloqueada',completed:'Concluída'}[remote.data?.cadences[l.id]??'']??'Sem cadência'):'Sem cadência'}</Badge>
                  </td>
                )}
                {visible("city") && (
                  <td className="city-cell">
                    {[l.city, l.state].filter(Boolean).join(", ") || "—"}
                  </td>
                )}
                {visible("source")&&<td>{l.source}</td>}
                {visible("created")&&<td>{new Date(l.createdAt).toLocaleDateString('pt-BR')}</td>}
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
        {!rows.length && !remote.loading && !remote.error && (
          <EmptyState
            icon="Search"
            title="Nenhum contato encontrado"
            description="Tente outro nome ou remova os filtros."
          />
        )}
      </div>
      {remote.loading&&!rows.length&&<p role="status">Carregando contatos…</p>}
      <div className="table-pagination">
        <small>
          {Math.min((page - 1) * 20 + 1, total)}–
          {Math.min(page * 20, total)} de {total}
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
            disabled={remote.loading||page * 20 >= total}
            onClick={() => setPage(page + 1)}
          />
        </div>
      </div>
      {manual && <LeadDialog onClose={() => setManual(false)} />}
      {importing && <ImportPreview onClose={() => setImporting(false)} />}
      {columns && (
        <Modal className="contacts-columns-drawer" title="Colunas da tabela" description="O que aparece em cada linha. Nome é fixo." onClose={() => setColumns(false)}>
          <div className="stack">
            {[
              ["contact", "Contato"],
              ["status", "Status"],
              ["cadence", "Cadência"],
              ["city", "Cidade / UF"],
              ["source", "Origem"],
              ["created", "Criado em"],
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
            <Button variant="ghost" onClick={()=>setHidden(['source','created'])}>Voltar ao padrão</Button>
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
          <div className="spacer"/><Button variant="ghost" onClick={()=>{setExcludeText(s.leads.filter(l=>selection.includes(l.id)).map(l=>l.email).filter(Boolean).join('\n'));setExclude(true);setExcludeReview(false);setBulk(false);}}>Excluir por e-mail…</Button>
        </Modal>
      )}
      {exclude&&<Modal title={excludeReview?'Confirmar exclusão de contatos':'Excluir por e-mail'} onClose={()=>{if(!deleting){setExclude(false);setExcludeReview(false);}}}><div className="stack">
        {excludeReview?<><p>{excluded.length} contatos com os e-mails informados serão removidos deste workspace. Esta ação não pode ser desfeita.</p><small>Contatos vinculados a operações podem impedir a exclusão. Nenhuma mensagem será enviada.</small></>:<><Field label="E-mails dos contatos"><textarea rows={7} value={excludeText} onChange={e=>setExcludeText(e.target.value)} placeholder="um@example.com\noutro@example.com"/></Field><p>{excludeEmails.size} e-mails válidos · {excluded.length} contatos encontrados</p></>}
        <div className="form-actions"><Button disabled={deleting} onClick={()=>excludeReview?setExcludeReview(false):setExclude(false)}>Voltar</Button><Button variant="primary" disabled={deleting||!excluded.length||excluded.length>500} onClick={async()=>{if(!excludeReview){setExcludeReview(true);return;}setDeleting(true);try{if(await run(()=>repo.deleteLeads(excluded.map(l=>l.id)),'Contatos removidos.')){setExclude(false);setExcludeText('');setExcludeReview(false);setSelection([]);}}finally{setDeleting(false);}}}>{excludeReview?(deleting?'Excluindo…':`Excluir ${excluded.length} contatos`):'Revisar exclusão'}</Button></div>{excluded.length>500&&<p role="alert">Use até500 contatos por ação.</p>}
      </div></Modal>}
    </div>
  );
}
