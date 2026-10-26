"use client";
import {useState} from 'react';
import Link from 'next/link';
import {useProspecting} from '@/client/workspace-provider';
import {useDemo} from '@/demo/provider';
import type {GenerationSource,Review,JobInput} from '@/domain/prospecting';
import {Button,Field,PageHeader,LinkButton,Notice} from '@/components/ui/primitives';
import {SourcePicker} from './source-picker';
import {JobReview} from './job-review';
import {ProviderStatus} from './provider-status';
import {Icon} from '@/components/ui/icon';
export function ServerGenerator({initialSource='MAPS'}:{initialSource?:string}){
  const client=useProspecting()!,state=useDemo();
  const [source,setSource]=useState<GenerationSource>(['MAPS','WEB','CNPJ','APOLLO'].includes(initialSource)?initialSource as GenerationSource:'MAPS');
  const [mode,setMode]=useState('new'),[name,setName]=useState(''),[listId,setListId]=useState(state.lists[0]?.id??''),[term,setTerm]=useState(''),[location,setLocation]=useState(''),[cnae,setCnae]=useState(''),[region,setRegion]=useState('');
  const [limit,setLimit]=useState(10),[scope,setScope]=useState<'list'|'workspace'>('workspace'),[review,setReview]=useState<Review|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function prepare(){setBusy(true);setError('');try{
    const filters:Record<string,string>={term,...(location?{location}:{}),...(source==='CNPJ'&&cnae?{includeCnae:cnae}:{}),...(source==='CNPJ'&&region?{states:region}:{})};
    const input:JobInput={kind:'generation',source,destination:mode==='new'?{mode:'new',name}:{mode:'existing',listId},filters,limit,dedupScope:scope};setReview(await client.prepare(input));
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível preparar.');}finally{setBusy(false);}}
  return <div className="prospecting-reference prospecting-generator"><PageHeader title="Gerador de leads" description="Encontre empresas no Google Maps, na busca da web ou na Base CNPJ e salve numa lista pronta pra qualificar."/>
    <p className="prospecting-inline-help">Esta é a forma avulsa: você roda agora, uma vez. <Link href="/automations/new">Em Automações</Link>, o sistema repete isso sozinho e traz leads novos toda semana.</p>
    <div className="prospecting-once"><Icon name="AlertCircle" size={16}/><span>Isto roda <strong>uma vez, agora.</strong></span><Link href="/automations/new">Para ter leads entrando sozinho, crie uma automação</Link></div>
    <form className="prospecting-generation-form" onSubmit={e=>{e.preventDefault();void prepare();}}>
      <section className="prospecting-panel prospecting-generation-fields"><div className="prospecting-field-label">Fonte de busca</div><SourcePicker value={source} onChange={s=>setSource(s as GenerationSource)}/>
        <div className="prospecting-narrow prospecting-destination"><div className="prospecting-field-label">Lista de destino</div><div className="prospecting-segment"><Button type="button" aria-pressed={mode==='new'} onClick={()=>setMode('new')} icon="Plus">Criar nova</Button><Button type="button" aria-pressed={mode==='existing'} disabled={!state.lists.length} onClick={()=>setMode('existing')} icon="ListChecks">Usar existente</Button></div>
        {mode==='new'?<input aria-label="Nome da lista" required minLength={2} maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="Nome da lista (ex: Dentistas SP)"/>:<Field label="Lista existente"><select required value={listId} onChange={e=>setListId(e.target.value)}><option value="">Selecione uma lista</option>{state.lists.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>}</div>
        {source!=='CNPJ'&&<div className="generator-ai-suggestion"><div className="prospecting-field-label">Palavra-chave / Nicho</div><div><input disabled aria-label="Descrever público para sugestão de IA" placeholder="Ex.: clínicas de estética em Curitiba"/><Button variant="primary" type="button" icon="Sparkles" disabled title="Sugestão avulsa de nicho ainda não disponível. Use o campo manual abaixo.">Sugerir com IA</Button></div><small>A sugestão avulsa ainda não está disponível. Informe o nicho manualmente abaixo.</small></div>}
        <div className="prospecting-narrow prospecting-search-fields"><Field label={source==='CNPJ'?'Nome do público':'Nicho da busca'}><input required maxLength={300} value={term} onChange={e=>setTerm(e.target.value)} placeholder="Ex: dentista, advogado, restaurante…"/></Field>
        {source==='CNPJ'&&<Field label="CNAEs separados por vírgula"><input required value={cnae} onChange={e=>setCnae(e.target.value)} placeholder="Ex: 6920601"/></Field>}
        <Field label={source==='CNPJ'?'Cidade (opcional)':'Localização'}><input required={source==='MAPS'||source==='WEB'} value={location} onChange={e=>setLocation(e.target.value)} placeholder="Ex: São Paulo, SP / Miami, FL"/></Field>
        {source==='CNPJ'&&<Field label="Estado (UF)"><input maxLength={2} value={region} onChange={e=>setRegion(e.target.value.toUpperCase())} placeholder="SP"/></Field>}
        <Field label="Máximo de candidatos" help="De 1 a 500. A fonte pode retornar menos empresas ou contatos incompletos."><input className="prospecting-limit" required type="number" min={1} max={500} value={limit} onChange={e=>setLimit(Number(e.target.value))}/></Field>
        <details className="prospecting-search-options"><summary>Opções da busca</summary><Field label="Evitar duplicados"><select value={scope} onChange={e=>setScope(e.target.value as typeof scope)}><option value="workspace">Em todo o workspace</option><option value="list">Somente na lista de destino</option></select></Field></details></div>
        {source==='CNPJ'&&<p className="prospecting-capability-note">A busca conectada aceita CNAE, cidade e UF. O nome do público é um rótulo. Outros filtros cadastrais dependem do provedor e não são enviados por esta tela.</p>}
        {source==='APOLLO'&&<Notice>O Apollo conectado busca empresas. Dados de pessoas e enriquecimento de e-mail não estão incluídos nesta busca.</Notice>}
      </section>
      <footer className="prospecting-panel prospecting-generation-footer"><p><Icon name="Shield" size={17}/>Os novos leads entram pendentes. Revise o consumo antes de confirmar; uma busca não envia mensagens nem ativa cadências.</p><Button variant="primary" type="submit" icon="Search" disabled={busy}>{busy?'Preparando revisão…':'Revisar busca'}</Button></footer>
      {error&&<p className="error-bar" role="alert">{error}</p>}
    </form><details className="prospecting-provider-details"><summary>Status das integrações e histórico</summary><ProviderStatus compact/><LinkButton href="/executions" icon="Clock">Histórico de execuções</LinkButton></details>
    {review&&<JobReview review={review} onClose={()=>setReview(null)} onConfirm={async()=>{const job=await client.confirm(review);window.location.assign('/executions/'+job.id);}}/>}
  </div>;
}
