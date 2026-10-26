"use client";
import {useIdentity} from '@/client/workspace-provider';
import {JobHistory} from '@/modules/prospecting/job-history';
import Link from 'next/link';
import {useState} from 'react';
import {useDemo} from '@/demo/provider';
import {calculateMetrics} from '@/domain/metrics';
import type {MessageMetrics} from '@/domain/message-metrics';
import {Icon} from '@/components/ui/icon';
import {PageHeader,EmptyState,Badge,LinkButton,Button} from '@/components/ui/primitives';
import {PeriodSelector} from '@/components/ui/period-selector';
import {useMessageMetrics} from '@/client/use-message-metrics';

export function Reports({tab='overview'}: {tab?:string}) {
  const s=useDemo(),[period,setPeriod]=useState('30 dias'),[cadence,setCadence]=useState('');
  const {metrics:messages,error:metricsError,live}=useMessageMetrics(period,cadence);
  const cadenceName=s.cadences.find(item=>item.id===cadence)?.name;
  return <div className="reports-reference">
    <PageHeader title="Relatórios" description="Desempenho dos disparos e do funil de vendas" actions={<div className="reports-header-controls"><PeriodSelector extended value={period} onChange={setPeriod}/><select aria-label="Cadência" className="reports-cadence-filter" value={cadence} onChange={e=>setCadence(e.target.value)}><option value="">Todas as cadências</option>{s.cadences.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}/>
    <nav className="reports-tabs" aria-label="Relatórios">{[['overview','Visão geral','/reports','ChartNoAxesColumn'],['funnel','Funil de vendas','/reports/funnel','Filter'],['negocios','Negócios CRM','/reports/negocios','Building2'],['performance','Performance','/reports/performance','ChartNoAxesColumn']].map(([key,label,href,icon])=><Link key={key} href={href} aria-current={tab===key?'page':undefined}><Icon name={icon} size={16}/>{label}</Link>)}</nav>
    {metricsError&&<p role="alert" className="reports-error">Indicadores de mensagens: {metricsError}</p>}
    {tab==='overview'?<ReportOverview messages={messages} period={period} cadence={cadence} live={live} error={metricsError}/>:tab==='funnel'?<ReportFunnel messages={messages} cadence={cadence}/>:tab==='performance'?<ReportPerformance messages={messages} cadenceName={cadenceName}/>:<section className="reports-panel reports-crm-state"><Icon name="AlertCircle" size={24}/><div><h2>Nenhuma integração FunnelsFlow ativa</h2><p>Ative uma integração para acompanhar o funil de negócios. A integração ainda está em preparação neste ambiente.</p><LinkButton href="/settings/apps" variant="primary">Configurar integração</LinkButton></div></section>}
  </div>;
}

function ReportsUnavailable({message='Medição indisponível',detail}: {message?:string;detail?:string}) {
  return <div className="reports-unavailable"><span aria-hidden="true">—</span><p>{message}</p>{detail&&<small>{detail}</small>}</div>;
}
function ReportOverview({messages,period,cadence,live,error}: {messages:MessageMetrics|null;period:string;cadence:string;live:boolean;error:string}) {
  if(!live||!messages||messages.sent===0)return <>
    <section className="reports-onboarding"><div className="reports-illustration" aria-hidden="true"><Icon name="ChartNoAxesColumn" size={68}/><Icon name="ArrowRight" size={22}/></div><h2>{live&&!messages?(error?'Não foi possível consultar os relatórios':'Consultando seus indicadores…'):'Os relatórios aparecem depois do primeiro envio'}</h2><p>{live&&!messages?'Aguarde a leitura do histórico de mensagens do workspace.':'Envios e respostas por canal e cadência. Aparecem depois do primeiro envio no período selecionado.'}</p><LinkButton href="/cadences" variant="primary">Ver cadências</LinkButton></section>
    <div className="reports-onboarding-cards">{[['Send','O que saiu','Envios por canal e cadência, no período que você escolher.'],['Inbox','Quem respondeu','Respostas: acompanhe as conversas que a prospecção está gerando.'],['ChartNoAxesColumn','Onde melhorar','O funil mostra os indicadores disponíveis e o que ainda não é medido.']].map(([icon,title,description])=><section className="reports-panel" key={title}><span><Icon name={icon} size={17}/></span><h3>{title}</h3><p>{description}</p></section>)}</div>
    <p className="reports-help">Como ler os relatórios? <Link href="/first-steps">Veja os primeiros passos</Link></p>
  </>;
  const stats=[['Mail','E-mails aceitos',messages.email],['MessageSquare','WhatsApp aceitos',messages.whatsapp],['Eye','Aberturas',null],['Link2','Cliques',null],['MessageSquare','Respostas',messages.replies],['XCircle','Bounces',cadence?null:messages.bounces],['LogOut','Opt-outs',cadence?null:messages.optouts]] as const;
  return <><div className="reports-metrics">{stats.map(([icon,label,value])=><section className="reports-panel" key={label}><div><small>{label}</small><Icon name={icon} size={15}/></div><strong>{value===null?'—':value.toLocaleString('pt-BR')}</strong><small>{value===null?'Medição indisponível neste filtro':'no período selecionado'}</small></section>)}</div><div className="reports-two-grid">
    <section className="reports-panel"><h3>Envios por dia</h3><p className="reports-chart-caption">{period} · mensagens aceitas pelo provedor</p><ReportSeries values={messages.series.map(item=>({date:item.date,value:item.sent}))} label="Envios por dia"/></section>
    <section className="reports-panel"><h3>Respostas por dia</h3><p className="reports-chart-caption">{period} · respostas recebidas</p><ReportSeries values={messages.series.map(item=>({date:item.date,value:item.replies}))} label="Respostas por dia"/></section>
    <section className="reports-panel"><h3>Engajamento por dia</h3><ReportsUnavailable message="Aberturas e cliques indisponíveis" detail="O rastreamento de abertura e clique ainda não está implementado."/></section>
    <section className="reports-panel"><h3>Bounces & Opt-outs por dia</h3><ReportsUnavailable message="Série diária indisponível" detail="Os totais disponíveis estão nos cartões acima."/></section>
  </div></>;
}

function ReportFunnel({messages,cadence}: {messages:MessageMetrics|null;cadence:string}) {
  const m=calculateMetrics(useDemo()),percent=m.total?Math.round(m.qualified/m.total*100):0;
  return <><div className="reports-metrics reports-funnel-metrics">{[['Total Leads',m.total,'base atual'],['Qualificados',m.qualified,`${percent}% da base atual`],['Em Cadência',null,'sem medição de inscritos'],['Conectados',null,'sem medição de conexões'],['Responderam',messages?.replies??null,'mensagens no período'],['Opt-outs',cadence?null:messages?.optouts??null,'no período']].map(([label,value,note])=><section className="reports-panel" key={String(label)}><small>{label}</small><strong>{value===null?'—':Number(value).toLocaleString('pt-BR')}</strong><small>{note}</small></section>)}</div>
    <section className="reports-panel reports-funnel"><h3>Funil de Conversão</h3><p className="reports-chart-caption">Leads e qualificados são uma fotografia da base atual. Inscrições em cadências e conexões ainda não têm medição neste relatório.</p><FunnelFigure total={m.total} qualified={m.qualified}/></section>
    <section className="reports-panel reports-qualification-history"><h3>Qualificação por Dia</h3><ReportsUnavailable message="Histórico diário de qualificação indisponível" detail="O cadastro informa o estado atual do lead; a data de criação não representa a data em que ele foi qualificado."/></section>
    <div className="reports-two-grid"><section className="reports-panel"><h3>Origem das Conexões</h3><ReportsUnavailable message="Origem das conexões indisponível"/></section><section className="reports-panel"><h3>Canal de Conexão</h3><ReportsUnavailable message="Medição de conexões indisponível"/></section></div>
  </>;
}

function FunnelFigure({total,qualified}:{total:number;qualified:number}){
 const qualifiedHeight=total?Math.max(8,qualified/total*100):8;
 const top=(height:number)=>65-height/2,bottom=(height:number)=>65+height/2;
 return <div className="reports-funnel-figure"><svg viewBox="0 0 1200 130" role="img" aria-label={'Funil da base atual: '+total+' leads e '+qualified+' qualificados. Etapas seguintes sem medição.'}><defs><pattern id="funnel-unmeasured" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="var(--hover)"/><line x1="0" x2="0" y1="0" y2="8" stroke="var(--border)" strokeWidth="3"/></pattern></defs><polygon points={'0,15 292,'+top(qualifiedHeight)+' 292,'+bottom(qualifiedHeight)+' 0,115'} fill="#94a3b8"/><polygon points={'302,'+top(qualifiedHeight)+' 594,57 594,73 302,'+bottom(qualifiedHeight)} fill="#548df5"/><polygon points="604,57 896,57 896,73 604,73" fill="url(#funnel-unmeasured)"/><polygon points="906,57 1200,57 1200,73 906,73" fill="url(#funnel-unmeasured)"/></svg><div className="reports-funnel-legend">{[['Total de Leads',total,'#94a3b8'],['Qualificados',qualified,'#548df5'],['Em Cadência',null,'#ff8a36'],['Conectados',null,'#40c977']].map(([label,value,color])=><div key={String(label)}><small><i style={{background:String(color)}}/>{label}</small><strong>{value===null?'—':Number(value).toLocaleString('pt-BR')}</strong><span>{value===null?'Medição indisponível':''}</span></div>)}</div></div>;
}

function ReportPerformance({messages,cadenceName}: {messages:MessageMetrics|null;cadenceName?:string}) {
  const [metric,setMetric]=useState('Envios');
  const value=metric==='Envios'?messages?.sent:metric==='Resposta'?messages?.replies:null;
  return <div className="reports-performance">
    <section className="reports-panel reports-comparison"><h3><Icon name="ChartNoAxesColumn" size={16}/>Comparativo entre Cadências: Taxas (%)</h3><ReportsUnavailable message="Taxas por cadência indisponíveis" detail="Os totais de mensagens não representam taxas por destinatário. A API atual não fornece este comparativo."/></section>
    <section className="reports-panel reports-cadence-detail"><div className="reports-panel-title"><h3><Icon name="Workflow" size={16}/>Detalhamento por Cadência</h3><div className="reports-metric-switch" role="group" aria-label="Métrica do detalhamento">{['Envios','Abertura','Clique','Resposta','Conexão'].map(item=><Button key={item} aria-pressed={metric===item} onClick={()=>setMetric(item)}>{item}</Button>)}</div></div>{cadenceName?<div className="reports-detail-row"><strong>{cadenceName}</strong><span>{metric}</span><strong>{value==null?'—':value.toLocaleString('pt-BR')}</strong><small>{value==null?'Medição indisponível':'mensagens no período selecionado'}</small></div>:<ReportsUnavailable message="Selecione uma cadência no filtro acima" detail="Consulte os totais de envios e respostas da cadência. Aberturas, cliques e conexões ainda não são medidos."/>}</section>
    <div className="reports-two-grid"><section className="reports-panel reports-stage-performance"><h3><Icon name="ListChecks" size={16}/>Performance por Etapa</h3><ReportsUnavailable message="Métricas por etapa indisponíveis" detail="A API atual não fornece o detalhamento por etapa da cadência."/></section><section className="reports-panel reports-best-times"><h3><Icon name="Clock" size={16}/>Melhores Horários (aberturas de e-mail)</h3><ReportsUnavailable message="Aberturas por horário indisponíveis" detail="O rastreamento de aberturas ainda não está implementado."/><p className="reports-chart-caption">Os horários serão comparáveis quando houver medição de abertura por dia e hora.</p></section></div>
  </div>;
}

function ReportSeries({values,label}: {values:{date:string;value:number}[];label:string}) {
  if(!values.length)return <ReportsUnavailable message="Sem dados no período selecionado"/>;
  const max=Math.max(...values.map(item=>item.value),1),points=values.map((item,index)=>`${32+(index*630)/Math.max(values.length-1,1)},${160-(item.value/max)*125}`).join(' ');
  const shortDate=(date:string)=>date.slice(8,10)+'/'+date.slice(5,7);
  return <div className="reports-series"><svg viewBox="0 0 700 200" role="img" aria-label={label}>{[35,75,115,160].map(y=><line key={y} x1="32" x2="668" y1={y} y2={y} stroke="#e5e7eb" strokeDasharray="3 4"/>)}<text x="4" y="38">{max}</text><text x="15" y="164">0</text><polyline points={points} fill="none" stroke="#ff6b00" strokeWidth="2.5" strokeLinejoin="round"/>{values.length===1&&<circle cx="32" cy={160-values[0].value/max*125} r="4" fill="#ff6b00"/>}<text x="32" y="190">{shortDate(values[0].date)}</text><text x="635" y="190">{shortDate(values[values.length-1].date)}</text></svg><details><summary>Ver dados da série</summary><table className="data-table"><thead><tr><th>DATA</th><th>{label.toLocaleUpperCase('pt-BR')}</th></tr></thead><tbody>{values.map(item=><tr key={item.date}><td>{shortDate(item.date)}</td><td>{item.value}</td></tr>)}</tbody></table></details></div>;
}

export function Executions({automationId}: {automationId?:string}) {return useIdentity()?<JobHistory automationId={automationId}/>:<DemoExecutions/>;}
function DemoExecutions() {
  const s=useDemo(),[filter,setFilter]=useState(''),jobs=s.jobs.filter(job=>!filter||job.type===filter);
  return <div className="reports-reference"><PageHeader title="Execuções" description="Histórico demonstrativo de geração, qualificação e automações."/><select className="reports-cadence-filter" aria-label="Tipo de execução" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">Todas as execuções</option><option value="generation">Geração</option><option value="qualification">Qualificação</option><option value="enrichment">Enriquecimento</option></select><section className="reports-panel">{jobs.length?<div className="table-scroll"><table className="data-table"><thead><tr><th>EXECUÇÃO</th><th>TIPO</th><th>RESULTADO</th><th>LEADS</th><th>DATA</th></tr></thead><tbody>{jobs.map(job=><tr key={job.id}><td>{job.name}<small>{job.details}</small></td><td><Badge>Demonstração local</Badge></td><td><Badge tone="green">Concluída</Badge></td><td>{job.count}</td><td>{new Date(job.createdAt).toLocaleString('pt-BR')}</td></tr>)}</tbody></table></div>:<EmptyState icon="Clock" title="Nenhuma execução encontrada" description="As simulações locais aparecem aqui. Ainda não há serviços externos conectados."/>}</section></div>;
}
