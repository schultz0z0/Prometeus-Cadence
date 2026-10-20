"use client";
import {useState} from 'react';
import {useProspecting} from '@/client/workspace-provider';
import {useDemo} from '@/demo/provider';
import type {GenerationSource,Review,JobInput} from '@/domain/prospecting';
import {Button,Field,PageHeader,LinkButton,Notice} from '@/components/ui/primitives';
import {SourcePicker} from './source-picker';
import {JobReview} from './job-review';
import {ProviderStatus} from './provider-status';
export function ServerGenerator({initialSource='MAPS'}:{initialSource?:string}){
  const client=useProspecting()!,state=useDemo();
  const [source,setSource]=useState<GenerationSource>(['MAPS','WEB','CNPJ','APOLLO'].includes(initialSource)?initialSource as GenerationSource:'MAPS');
  const [mode,setMode]=useState('new'),[name,setName]=useState(''),[listId,setListId]=useState(state.lists[0]?.id??''),[term,setTerm]=useState(''),[location,setLocation]=useState(''),[cnae,setCnae]=useState(''),[region,setRegion]=useState('');
  const [limit,setLimit]=useState(10),[scope,setScope]=useState<'list'|'workspace'>('workspace'),[review,setReview]=useState<Review|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function prepare(){setBusy(true);setError('');try{
    const filters:Record<string,string>={term,...(location?{location}:{}),...(source==='CNPJ'&&cnae?{includeCnae:cnae}:{}),...(source==='CNPJ'&&region?{states:region}:{})};
    const input:JobInput={kind:'generation',source,destination:mode==='new'?{mode:'new',name}:{mode:'existing',listId},filters,limit,dedupScope:scope};setReview(await client.prepare(input));
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível preparar.');}finally{setBusy(false);}}
  return <><PageHeader title="Gerador de leads" description="Encontre empresas, revise o consumo e acompanhe a busca em uma lista persistente." actions={<LinkButton href="/executions" icon="Clock">Histórico</LinkButton>}/><ProviderStatus compact/>
    <form className="stack section-gap" onSubmit={e=>{e.preventDefault();void prepare();}}>
      <SourcePicker value={source} onChange={s=>setSource(s as GenerationSource)}/>
      <section className="panel panel-pad stack"><h3>Lista de destino</h3><div className="row"><Button type="button" variant={mode==='new'?'soft':''} onClick={()=>setMode('new')}>Criar nova</Button><Button type="button" variant={mode==='existing'?'soft':''} onClick={()=>setMode('existing')}>Usar existente</Button></div>
        {mode==='new'?<Field label="Nome da lista"><input required minLength={2} maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Dentistas SP"/></Field>:<Field label="Lista existente"><select required value={listId} onChange={e=>setListId(e.target.value)}><option value="">Selecione uma lista</option>{state.lists.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>}
        <div className="field-grid"><Field label={source==='CNPJ'?'Nome do público':'Palavra-chave / Nicho'}><input required maxLength={300} value={term} onChange={e=>setTerm(e.target.value)} placeholder="Ex.: clínicas de estética"/></Field><Field label={source==='CNPJ'?'Cidade (opcional)':'Localização'}><input required={source==='MAPS'||source==='WEB'} value={location} onChange={e=>setLocation(e.target.value)} placeholder="Ex.: São Paulo"/></Field></div>
        {source==='CNPJ'&&<><div className="field-grid"><Field label="CNAEs separados por vírgula"><input required value={cnae} onChange={e=>setCnae(e.target.value)} placeholder="6920601"/></Field><Field label="Estado (UF)"><input maxLength={2} value={region} onChange={e=>setRegion(e.target.value.toUpperCase())} placeholder="SP"/></Field></div><Notice>Consulta por Actor externo. O nome do público é um rótulo; o CNAE e os filtros cadastrais delimitam a busca. Cobertura e custo dependem do perfil conectado.</Notice></>}
        {source==='APOLLO'&&<Notice>A busca de empresas usa o endpoint Organizations do Apollo. Dados de pessoas, enriquecimento de e-mail e gratuidade não estão incluídos.</Notice>}
        <div className="field-grid"><Field label="Máximo de candidatos" help="De 1 a 500. A fonte pode retornar menos empresas ou contatos incompletos."><input required type="number" min={1} max={500} value={limit} onChange={e=>setLimit(Number(e.target.value))}/></Field><Field label="Evitar duplicados"><select value={scope} onChange={e=>setScope(e.target.value as typeof scope)}><option value="workspace">Em todo o workspace</option><option value="list">Somente na lista de destino</option></select></Field></div>
        <Notice>Os novos leads entram pendentes. Uma busca não envia mensagens nem ativa cadências.</Notice>{error&&<p className="error-bar" role="alert">{error}</p>}<div className="form-actions"><Button variant="primary" type="submit" disabled={busy}>{busy?'Preparando revisão…':'Revisar busca'}</Button></div>
      </section>
    </form>{review&&<JobReview review={review} onClose={()=>setReview(null)} onConfirm={async()=>{const job=await client.confirm(review);window.location.assign('/executions/'+job.id);}}/>}
  </>;
}
