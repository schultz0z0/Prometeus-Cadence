'use client';

import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useReports} from '@/client/workspace-provider';
import {useLiveRefresh} from '@/client/use-live-refresh';
import {Icon} from '@/components/ui/icon';
import {Button,LinkButton} from '@/components/ui/primitives';
import {SelectMenu} from '@/components/ui/select-menu';
import {executionStatuses,type ExecutionDiaryPage,type ExecutionStatus} from '@/domain/execution-diary';
import styles from './execution-diary.module.css';

const cards = {
  success:{title:'Sucesso',icon:'CheckCircle2',description:'Saiu como planejado.'},
  error:{title:'Erro',icon:'XCircle',description:'Falhou e precisa de ação sua (caixa, WhatsApp, configuração).'},
  skipped:{title:'Pulado',icon:'AlertCircle',description:'O motor decidiu não enviar, o motivo diz por quê (sem e-mail, já respondeu, teto do dia…).'},
  progress:{title:'Em andamento',icon:'Hourglass',description:'Está saindo agora ou esperando a vez.'},
} as const;
const channels = {EMAIL:'E-mail',WHATSAPP:'WhatsApp',LINKEDIN:'LinkedIn'} as const;
const statusOptions = [['all','Todos os status'],...executionStatuses.map(status=>[status,cards[status].title] as const)] as const;
const periodOptions = [['all','Todo o histórico'],['today','Hoje'],['7','Últimos 7 dias'],['30','Últimos 30 dias']] as const;
const detailOptions = [['essential','Só o que importa'],['trace','Tudo, com rastreio']] as const;
const channelOptions = [['all','Todos os canais'],['EMAIL',channels.EMAIL],['WHATSAPP',channels.WHATSAPP],['LINKEDIN',channels.LINKEDIN]] as const;
const sizeOptions = [['25','25'],['50','50'],['100','100']] as const;
type DiaryFilters = {
  q:string;
  status:ExecutionStatus|'all';
  period:typeof periodOptions[number][0];
  detail:typeof detailOptions[number][0];
  channel:typeof channelOptions[number][0];
  size:typeof sizeOptions[number][0];
  page:string;
};
const initialFilters:DiaryFilters = {q:'',status:'all',period:'all',detail:'essential',channel:'all',size:'50',page:'1'};
const heading = ['Quando','O que aconteceu','Lead','Cadência','Canal'];

function EmptyDiary({filtered}:{filtered:boolean}) {
  if (filtered) return <div className={styles.empty}>
    <h2>Nenhuma execução para estes filtros</h2>
    <p>Altere a busca ou os filtros para ver outras execuções.</p>
  </div>;
  return <div className={styles.emptyWrap}>
    <div className={styles.empty}>
      <svg width="156" height="96" viewBox="0 0 156 96" fill="none" aria-hidden="true">
        <rect x="19" y="12" width="118" height="74" rx="11" fill="white" stroke="#274777" strokeWidth="2"/>
        <path d="M4 47h21m-5-5 5 5-5 5M31 30h48m-48 18h54m-54 18h48" stroke="#274777" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="118" cy="48" r="11" fill="#ffead8"/><path d="m113 48 3 3 7-7" stroke="#ff6b00" strokeWidth="2" strokeLinecap="round"/>
      </svg>
      <h2>Nenhuma execução ainda</h2>
      <p>Quando uma cadência rodar, cada ação aparece aqui, com o resultado e o motivo quando algo não sai.</p>
      <LinkButton href="/cadences">Ver cadências</LinkButton>
    </div>
    <p className={styles.help}>Algo não saiu? <button type="button" className="text-button" onClick={()=>window.dispatchEvent(new Event('help-open'))}>Leia o guia na Central de Ajuda</button></p>
  </div>;
}

export function ExecutionDiary() {
  const client = useReports();
  const [filters,setFilters] = useState(initialFilters);
  const [retry,setRetry] = useState(0);
  const [result,setResult] = useState<{key:string;client:typeof client;data?:ExecutionDiaryPage;error?:string}>();
  const query = new URLSearchParams(filters).toString();
  const key = query+':'+retry;
  const current = result?.key===key&&result.client===client?result:undefined;
  const data = current?.data;

  useEffect(()=>{
    if (!client) return;
    let active = true;
    const timer = window.setTimeout(()=>{
      client.executionDiary(query).then(data=>{
        if (active) setResult({key,client,data});
      }).catch((error:Error)=>{
        if (active) setResult({key,client,error:error.message});
      });
    },180);
    return ()=>{active=false;window.clearTimeout(timer);};
  },[client,key,query]);

  useLiveRefresh(async signal=>{
    if (!client) return;
    const fresh = await client.executionDiary(query);
    if (!signal.aborted) setResult(previous=>previous?.key===key&&previous.client===client?{key,client,data:fresh}:previous);
  },15000,!!data,key);

  function change<K extends keyof DiaryFilters>(name:K,value:DiaryFilters[K]) {
    setFilters(previous=>({...previous,page:'1',[name]:value}));
  }

  const page = data?.page??1;
  const pages = Math.max(1,Math.ceil((data?.total??0)/Number(filters.size)));
  const filtered = !!filters.q.trim()||filters.period!=='all'||filters.status!=='all'||filters.channel!=='all';
  const date = data?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:data.timezone}):null;

  return <section className={styles.diary} aria-labelledby="execution-diary-title">
    <header className={styles.heading}>
      <h1 id="execution-diary-title">Execuções <span>{data?.total??'—'}</span></h1>
      <p>O diário das suas cadências: cada mensagem que saiu, cada uma que não saiu e o motivo</p>
    </header>

    <div className={styles.cards} aria-label="Resultados por status">
      {executionStatuses.map(status=>{
        const card = cards[status];
        const selected = filters.status===status;
        return <button type="button" key={status} aria-pressed={selected}
          onClick={()=>change('status',selected?'all':status)}>
          <span><Icon name={card.icon} size={14}/>{card.title}<strong>{data?.counts[status]??'—'}</strong></span>
          <small>{card.description}</small>
        </button>;
      })}
    </div>

    <div className={styles.filters} aria-label="Filtros de execuções">
      <label className={styles.search}>
        <Icon name="Search" size={16}/>
        <input type="search" aria-label="Buscar execuções" placeholder="Buscar lead, cadência ou motivo…"
          value={filters.q} maxLength={120} onChange={event=>change('q',event.target.value)}/>
      </label>
      <SelectMenu label="Período" value={filters.period} options={periodOptions} onChange={value=>change('period',value)}/>
      <SelectMenu label="Status" value={filters.status} options={statusOptions} onChange={value=>change('status',value)}/>
      <SelectMenu label="Detalhe" value={filters.detail} options={detailOptions} onChange={value=>change('detail',value)}/>
      <SelectMenu label="Canal" value={filters.channel} options={channelOptions} onChange={value=>change('channel',value)}/>
    </div>

    <div className={styles.tableWrap} aria-busy={!!client&&!current}>
      <table className={styles.table} aria-label="Diário das cadências">
        <thead><tr>{heading.map(title=><th key={title} scope="col">{title}</th>)}</tr></thead>
        <tbody>
          {data?.items.length ? data.items.map(item=><tr className={styles.entry} key={item.trace?'trace:'+item.id:item.id}>
            <td data-label={heading[0]}><time dateTime={item.at}>{date?.format(new Date(item.at))}</time></td>
            <td data-label={heading[1]}><strong data-status={item.status}>{cards[item.status].title}</strong><span>{item.event}</span></td>
            <td data-label={heading[2]}>{item.leadId&&item.lead?<Link href={'/leads/'+encodeURIComponent(item.leadId)}>{item.lead}</Link>:item.lead??'—'}</td>
            <td data-label={heading[3]}><Link href={'/cadences/'+encodeURIComponent(item.cadenceId)}>{item.cadence??'Cadência'}</Link></td>
            <td data-label={heading[4]}>{channels[item.channel]}</td>
          </tr>) : <tr><td colSpan={5}>
            {data ? <EmptyDiary filtered={filtered}/> : <div className={styles.readState}>
              {current?.error ? <><p role="alert">{current.error}</p><Button onClick={()=>setRetry(value=>value+1)}>Tentar novamente</Button></>
                : <p role="status">{client?'Carregando execuções…':'Entre em um workspace para consultar as execuções.'}</p>}
            </div>}
          </td></tr>}
        </tbody>
      </table>
    </div>

    <footer className={styles.footer}>
      <div className={styles.results}>
        <span aria-live="polite">{data?data.total+' '+(data.total===1?'resultado':'resultados'):'— resultados'}</span>
        <span>por página</span>
        <SelectMenu label="Por página" value={filters.size} options={sizeOptions} onChange={value=>change('size',value)} up/>
      </div>
      <nav className={styles.pages} aria-label="Paginação das execuções">
        <button type="button" aria-label="Página anterior" disabled={!data||page<=1} onClick={()=>change('page',String(page-1))}><Icon name="ChevronLeft" size={16}/></button>
        <span>{page} / {pages}</span>
        <button type="button" aria-label="Próxima página" disabled={!data||page>=pages} onClick={()=>change('page',String(page+1))}><Icon name="ChevronRight" size={16}/></button>
      </nav>
    </footer>
  </section>;
}
