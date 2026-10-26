"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseContactImport, mapImportedContacts } from "@/domain/import";
import { useDemo, useRepository, useAction } from "@/demo/provider";
import { useIdentity } from "@/client/workspace-provider";
import { useShellBilling } from "@/client/use-shell-billing";
import { Button, Field, LinkButton, Modal, Notice, PageHeader } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";

export function ImportPreview({ onClose }: { onClose: () => void }) {
  return <Modal wide title="Importar Leads" description="Importe leads por CSV ou insira manualmente" onClose={onClose}><ImportLeadsFlow onImported={onClose}/></Modal>;
}

export function ImportLeadsPage() {
  const router = useRouter();
  return <div className="prospecting-reference prospecting-import-page"><PageHeader title="Importar Leads" description="Importe leads por CSV ou insira manualmente" actions={<LinkButton href="/contacts" icon="ArrowLeft">Leads</LinkButton>}/><ImportLeadsFlow onImported={()=>router.push('/contacts')}/></div>;
}

function ImportLeadsFlow({ onImported }: { onImported: () => void }) {
  const s=useDemo(),repo=useRepository(),run=useAction(),identity=useIdentity();
  const billing=useShellBilling(identity?.activeWorkspaceId??null);
  const balance=billing?.balances.find(item=>item.unit==='imports');
  const fileInput=useRef<HTMLInputElement>(null);
  const [newListId]=useState(()=>crypto.randomUUID()),[newListName,setNewListName]=useState("Contatos importados");
  const [destinationMode,setDestinationMode]=useState<'new'|'existing'>(s.lists.length?'existing':'new');
  const [listId,setListId]=useState(s.lists[0]?.id??''),[text,setText]=useState(''),[source,setSource]=useState<'file'|'manual'>('file'),[step,setStep]=useState(0),[fileName,setFileName]=useState(''),[error,setError]=useState(''),[reading,setReading]=useState(false),[saving,setSaving]=useState(false),[dragging,setDragging]=useState(false);
  const [map,setMap]=useState<Partial<Record<'name'|'email'|'phone'|'site'|'city'|'state',number>>>({name:0,email:1,phone:2});
  const p=useMemo(()=>parseContactImport(text),[text]);
  const destination=destinationMode==='new'?newListId:listId;
  const m=useMemo(()=>mapImportedContacts(p,map,destination),[p,map,destination]);
  const hasDestination=destinationMode==='new'?!!newListName.trim():!!listId;
  const canReview=m.leads.length>0&&m.leads.length<=500&&map.name!==-1&&p.errors.length===0&&hasDestination;
  async function readFile(file:File) {
    if(file.size>5000000){setError('Use um arquivo de até 5 MB.');return;}
    if(!/\.(csv|txt|tsv)$/i.test(file.name)){setError('Escolha um arquivo CSV, TXT ou TSV.');return;}
    setError('');setReading(true);
    try{setText(await file.text());setFileName(file.name);setStep(0);}catch{setError('Não foi possível ler o arquivo. Tente novamente.');}finally{setReading(false);}
  }
  async function importContacts() {
    if(saving||!canReview)return;
    setSaving(true);
    try {
      if(await run(async()=>await repo.importLeads(m.leads,destinationMode==='new'?{id:newListId,name:newListName.trim()}:undefined),`${m.leads.length} contatos importados.`))onImported();
    } finally {setSaving(false);}
  }
  return <div className="prospecting-reference prospecting-import">
    <ol className="prospecting-import-steps" aria-label="Etapas da importação">{['Arquivo','Colunas','Revisar e importar'].map((title,index)=><li key={title} aria-current={step===index?'step':undefined} className={step===index?'active':step>index?'done':''}><span>{index+1}</span>{title}</li>)}</ol>
    <div className="prospecting-import-quota">{balance?<><Icon name="Timer" size={16}/><span><strong>{(balance.plan+balance.purchased).toLocaleString('pt-BR')}</strong> importações disponíveis{balance.reserved>0?` · ${balance.reserved.toLocaleString('pt-BR')} reservadas`:''}</span><small>Máximo de 500 contatos por lote.</small></>:<span>{identity?'Saldo de importações ainda não disponível':'Importação em demonstração'} · máximo de 500 contatos por lote.</span>}</div>
    {step===0?<>
      <div className="prospecting-import-tabs" role="group" aria-label="Origem da importação"><Button type="button" aria-pressed={source==='file'} icon="FileText" onClick={()=>setSource('file')}>Arquivo CSV</Button><Button type="button" aria-pressed={source==='manual'} icon="Pencil" onClick={()=>setSource('manual')}>Digitar / colar</Button></div>
      <section className="prospecting-panel prospecting-import-source">
        {source==='file'?<>
          <div className={`prospecting-dropzone ${dragging?'dragging':''}`} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);const file=e.dataTransfer.files[0];if(file)void readFile(file);}}>
            <Icon name="Upload" size={36}/><button type="button" disabled={reading} onClick={()=>fileInput.current?.click()}>{reading?'Lendo arquivo…':fileName||'Arraste o arquivo aqui ou clique para escolher'}</button><small>.csv ou .txt · vírgula ou ponto-e-vírgula · a 1ª linha é o cabeçalho</small><input ref={fileInput} type="file" accept=".csv,.txt,.tsv" aria-label="Escolher arquivo para importar" className="prospecting-file-input" onChange={e=>{const file=e.target.files?.[0];if(file)void readFile(file);}}/>
          </div>
          <a className="prospecting-download-template" download="modelo-contatos.csv" href={'data:text/csv;charset=utf-8,'+encodeURIComponent('Nome,E-mail,Telefone,Site,Cidade,Estado\nEmpresa exemplo,contato@empresa.example,11900000000,https://empresa.example,São Paulo,SP\n')}><Icon name="Download" size={14}/>Baixar modelo de planilha</a>
          <p className="prospecting-import-tip">Você confere e mapeia as colunas no próximo passo.</p><details className="prospecting-import-columns-help"><summary>Quais colunas podemos importar?</summary><p>Nome, e-mail, telefone, site, cidade e estado. Confira o mapeamento antes de importar; o nome é obrigatório.</p></details>
        </>:<><h2>Adicionar leads manualmente</h2><p>Insira um lead por linha em formato CSV, com os nomes das colunas na primeira linha. Você confere o mapeamento no próximo passo.</p><Field label="Dados dos contatos"><textarea rows={9} placeholder={'Nome,E-mail,Telefone\nEmpresa exemplo,contato@empresa.example,11900000000'} value={text} onChange={e=>{setText(e.target.value);setError('');}}/></Field><small>{p.rows.length} linhas de contatos</small></>}
        {error&&<p className="error-bar" role="alert">{error}</p>}
        {text.trim()&&p.errors.length>0&&<Notice tone="error">{p.errors.map((item,index)=><p key={index}>Linha {item.line}: {item.message}</p>)}</Notice>}
        {text.trim()&&<div className="form-actions"><Button variant="primary" disabled={reading||!p.rows.length||p.errors.length>0} onClick={()=>setStep(1)}>Mapear colunas <Icon name="ArrowRight" size={15}/></Button></div>}
      </section>
    </>:<section className="prospecting-panel prospecting-import-mapping">
      {step===1?<>
        <h2>Lista de destino</h2><div className="prospecting-segment prospecting-narrow"><Button type="button" aria-pressed={destinationMode==='new'} onClick={()=>setDestinationMode('new')} icon="Plus">Criar nova lista</Button><Button type="button" aria-pressed={destinationMode==='existing'} disabled={!s.lists.length} onClick={()=>setDestinationMode('existing')} icon="ListChecks">Usar existente</Button></div>
        <div className="prospecting-narrow">{destinationMode==='new'?<Field label="Nome da nova lista"><input required maxLength={100} value={newListName} onChange={e=>setNewListName(e.target.value)}/></Field>:<Field label="Lista existente"><select value={listId} onChange={e=>setListId(e.target.value)}><option value="">Selecione uma lista</option>{s.lists.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}</div>
        <h2>Mapear colunas</h2><p>Escolha a coluna de origem para cada informação. Nome é obrigatório.</p><div className="prospecting-import-mapping-grid">{([['name','Nome *'],['email','E-mail'],['phone','Telefone'],['site','Site'],['city','Cidade'],['state','Estado']] as const).map(([key,label])=><Field key={key} label={label}><select value={map[key]??-1} onChange={e=>setMap({...map,[key]:Number(e.target.value)})}><option value={-1}>Não importar</option>{p.headers.map((header,index)=><option key={index} value={index}>{header||`Coluna ${index+1}`}</option>)}</select></Field>)}</div>
      </>:<><h2>Revisar e importar</h2><p>Destino: <strong>{destinationMode==='new'?newListName:s.lists.find(item=>item.id===listId)?.name}</strong>. Os contatos entram pendentes para qualificação.</p></>}
      <div className="prospecting-import-count"><strong>{m.leads.length}</strong> contatos válidos <span>· {m.errors.length} erros</span></div>
      {m.leads.length>500&&<Notice tone="error">Este lote tem mais de 500 contatos. Divida o arquivo em lotes de até 500 para importar.</Notice>}
      {m.errors.length>0&&<Notice tone="error">{m.errors.slice(0,5).map((item,index)=><p key={index}>Linha {item.line}: {item.message}</p>)}<p>Linhas sem nome não serão importadas. Revise o arquivo se quiser incluí-las.</p></Notice>}
      <div className="table-scroll"><table className="data-table"><thead><tr><th>NOME</th><th>E-MAIL</th><th>TELEFONE</th></tr></thead><tbody>{m.leads.slice(0,10).map(lead=><tr key={lead.id}><td>{lead.name}</td><td>{lead.email||'—'}</td><td>{lead.phone||'—'}</td></tr>)}</tbody></table></div><small>Prévia dos primeiros {Math.min(m.leads.length,10)} contatos válidos.</small>
      {step===2&&<Notice>A confirmação salva os {m.leads.length} contatos válidos na lista selecionada. Nenhuma mensagem será enviada.</Notice>}
      <div className="form-actions"><Button disabled={saving} onClick={()=>setStep(step-1)}>Voltar</Button>{step===1?<Button variant="primary" disabled={!canReview} onClick={()=>setStep(2)}>Revisar importação <Icon name="ArrowRight" size={15}/></Button>:<Button variant="primary" disabled={saving||!canReview} onClick={()=>void importContacts()}>{saving?'Importando…':`Importar ${m.leads.length} contatos válidos`}</Button>}</div>
    </section>}
  </div>;
}
