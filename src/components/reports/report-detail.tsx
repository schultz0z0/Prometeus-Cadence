"use client";
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {useReports} from '@/client/workspace-provider';
import {Button,Modal} from '@/components/ui/primitives';
import {reportMetricDefinitions,type ReportMetric,type ReportQuery,type ReportView} from '@/domain/reporting';
export function ReportDetail({metric,query,onClose}:{metric:ReportMetric;query:ReportQuery;onClose:()=>void}){
 const client=useReports(),[result,setResult]=useState<ReportView|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0),scope=JSON.stringify(query);
 useEffect(()=>{let active=true;setResult(null);setError('');if(client){setBusy(true);client.detail(metric,JSON.parse(scope)).then(value=>{if(active)setResult(value);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});}return()=>{active=false;};},[client,metric,scope,reload]);
 async function more(){if(!client||!result?.nextCursor)return;setBusy(true);try{const next=await client.detail(metric,{...query,cursor:result.nextCursor});setResult({...next,items:[...result.items,...next.items]});setError('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const definition=reportMetricDefinitions[metric];
 return <Modal title="Detalhe do indicador" onClose={onClose} wide><p>{definition.description}</p><small>{new Date(query.from).toLocaleString('pt-BR',{timeZone:query.timezone})} até {new Date(query.to).toLocaleString('pt-BR',{timeZone:query.timezone})} (fim exclusivo) · {query.timezone}</small>
 {error&&<p role="alert">{error} <Button onClick={()=>setReload(x=>x+1)}>Consultar novamente</Button></p>}
 {!result&&busy&&<p role="status">Carregando registros…</p>}
 {result&&<><p><strong>{result.totals[metric]??'—'}</strong> registros · atualizado em {new Date(result.asOf).toLocaleString('pt-BR',{timeZone:query.timezone})}</p><div className="table-scroll"><table className="data-table"><thead><tr><th>Data</th><th>Canal / tipo</th><th>Estado</th><th>Origem</th></tr></thead><tbody>{result.items.map(item=><tr key={item.id}><td>{new Date(item.occurredAt).toLocaleString('pt-BR',{timeZone:query.timezone})}</td><td>{item.channel??item.kind}</td><td>{item.state}</td><td><Link href={item.href.split('?')[0]}>{item.kind==='message'?'Abrir caixa':'Abrir registro'}</Link></td></tr>)}</tbody></table></div>{!result.items.length&&<p>Nenhum registro neste período.</p>}{result.nextCursor&&<Button disabled={busy||!!error} onClick={()=>void more()}>{busy?'Carregando…':'Ver mais registros'}</Button>}</>}
 </Modal>;
}
export function ReportStamp({report,error,onRefresh}:{report:ReportView|null;error:string;onRefresh:()=>Promise<unknown>}){
 return <div className="row between wrap reports-stamp"><small>{report?<>Atualizado em {new Date(report.asOf).toLocaleString('pt-BR',{timeZone:report.period.timezone})} · {report.period.timezone}{error?' · última leitura; atualização falhou':''}</>:'Consultando indicadores…'}</small><Button icon="RefreshCw" onClick={()=>void onRefresh().catch(()=>{})}>Atualizar indicadores</Button>{error&&<p role="alert">{error}</p>}</div>;
}
export function exportReport(report:ReportView){const blob=new Blob([JSON.stringify({period:report.period,asOf:report.asOf,totals:report.totals,series:report.series,cadences:report.cadences,steps:report.steps,definitions:report.definitions,attribution:report.attribution},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='relatorio-'+report.period.from.slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
