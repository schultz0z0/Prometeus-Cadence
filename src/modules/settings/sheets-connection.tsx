"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useIdentity} from '@/client/workspace-provider';
import {sheetColumns,sheetEvents,type ConnectionView,type SheetColumn,type SheetEvent} from '@/domain/connector-capabilities';
import {Button,Field,Modal,Notice} from '@/components/ui/primitives';
import {Icon} from '@/components/ui/icon';
import {useConnectorApi,useConnections} from './apollo-connection';
const defaultColumns:SheetColumn[]=['name','companyName','email','phone','qualification','list','event','exportedAt'];
const oauthNotice:Record<string,[string,'success'|'error']>={
 connected:['Conta Google conectada. Agora escolha a planilha.','success'],
 failed:['O Google não concluiu a autorização. Tente conectar de novo.','error'],
 scope:['A autorização não incluiu o acesso às planilhas. Conecte de novo e marque a permissão pedida.','error'],
};
const attentionAction:Record<string,{label:string;action:'repair'|'retry'|'new'|'reconnect'}>={
 schema:{label:'Restaurar cabeçalho',action:'repair'},missing:{label:'Criar planilha nova',action:'new'},
 reconnect:{label:'Reconectar conta Google',action:'reconnect'},forbidden:{label:'Reconectar conta Google',action:'reconnect'},
};
function Header(){return <header><Link href="/settings/apps" aria-label="Voltar para CRM e apps"><Icon name="ArrowLeft" size={20}/></Link><span><Icon name="Sheet" size={22}/></span><div><h1>Google Sheets</h1><p>Exportação automática de leads para planilha</p></div></header>;}
export function SheetsConnection(){
 const identity=useIdentity(),canManage=['owner','admin'].includes(identity?.workspaces.find(w=>w.id===identity.activeWorkspaceId)?.role??'');
 const api=useConnectorApi(),{items,error:loadError,load}=useConnections(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[editing,setEditing]=useState(false),[confirm,setConfirm]=useState(false);
 const [oauth,setOauth]=useState<string|null>(null);
 useEffect(()=>{const q=new URLSearchParams(window.location.search).get('oauth');if(q&&oauthNotice[q]){setOauth(q);window.history.replaceState(null,'',window.location.pathname);}},[]);
 const live=items?.find(c=>c.kind==='google-sheets')??null;
 async function run(fn:()=>Promise<unknown>,done?:string){setBusy(true);setError('');setMessage('');try{await fn();if(done)setMessage(done);}catch(e){setError((e as Error).message);}finally{setBusy(false);load();}}
 async function authorize(){setBusy(true);setError('');try{const r=await api<{authorizationUrl:string}>('/api/integrations',{action:'sheets-authorize'});window.location.assign(r.authorizationUrl);}catch(e){setError((e as Error).message);setBusy(false);}}
 const act=(action:'pause'|'activate'|'retry'|'repair',done:string)=>live&&run(()=>api(`/api/integrations/${live.id}/sheets`,{action,expectedRevision:live.configRevision}),done);
 const alerts=<>{oauth&&<Notice tone={oauthNotice[oauth][1]}>{oauthNotice[oauth][0]}</Notice>}{error&&<div role="alert"><Notice tone="error">{error}</Notice></div>}
  <p className="sr-only" role="status">{message}</p>{message&&<Notice tone="success">{message}</Notice>}</>;
 if(loadError)return <div className="reference-settings integration-google"><Header/><Notice tone="error">{loadError} <button type="button" className="text-button" onClick={load}>Tentar de novo</button></Notice></div>;
 if(!items)return <div className="reference-settings integration-google"><Header/><p role="status">Consultando a conexão…</p></div>;
 if(!live)return <div className="reference-settings integration-google"><Header/>{alerts}
  <section className="reference-panel"><span><Icon name="Sheet" size={30}/></span><h2>Conectar Google Sheets</h2><p>Conecte sua conta Google para enviar leads automaticamente para uma planilha. Você poderá escolher a planilha, mapear campos e configurar gatilhos.</p>
   <Button variant="primary" icon="Link2" disabled={busy||!canManage} onClick={()=>void authorize()}>{busy?'Abrindo o Google…':'Conectar conta Google'}</Button>
   {!canManage&&<small>Somente proprietário ou administrador conecta o Google.</small>}</section></div>;
 const disconnect=<>{canManage&&<Button type="button" variant="ghost" disabled={busy} onClick={()=>setConfirm(true)}>Desconectar</Button>}
  {confirm&&<Modal title="Desconectar o Google Sheets?" onClose={()=>setConfirm(false)}><div className="stack"><p>O acesso guardado é apagado e os leads na fila não são mais exportados. A planilha continua na sua conta Google. Para remover também a permissão no Google, use myaccount.google.com/permissions.</p>
   <div className="form-actions"><Button type="button" onClick={()=>setConfirm(false)}>Cancelar</Button><Button type="button" variant="danger" onClick={()=>{setConfirm(false);setEditing(false);void run(()=>api(`/api/integrations/${live.id}/disconnect`,{expectedRevision:live.revision}),'Google Sheets desconectado.');}}>Desconectar</Button></div></div></Modal>}</>;
 if(!live.config||editing)return <div className="reference-settings integration-google"><Header/>{alerts}
  <SheetsSetup live={live} busy={busy} canManage={canManage} onCancel={live.config?()=>setEditing(false):undefined}
   onSubmit={input=>run(async()=>{await api('/api/integrations',{action:'sheets-configure',input:{...input,expectedRevision:live.configRevision??0}});setEditing(false);},'Planilha criada. Os próximos leads entram nela automaticamente.')}/>
  <div className="form-actions sheets-footer">{disconnect}</div></div>;
 const c=live.config,fix=live.attention?attentionAction[live.attention]:null;
 return <div className="reference-settings integration-google"><Header/>{alerts}
  {live.attention&&<Notice tone="error">{live.lastError??'A exportação precisa de atenção.'} {canManage&&fix&&<Button type="button" disabled={busy} onClick={()=>fix.action==='reconnect'?void authorize():fix.action==='new'?setEditing(true):void act(fix.action,'Exportação retomada.')}>{fix.label}</Button>}</Notice>}
  <section className="reference-panel sheets-config"><header><Icon name="Sheet" size={18}/><div className="grow"><h2>Planilha conectada</h2>
   <p>Planilha <strong>{c.spreadsheetName}</strong> · <a href={`https://docs.google.com/spreadsheets/d/${c.spreadsheetId}`} target="_blank" rel="noreferrer">abrir no Google</a></p></div>
   <span className={'badge '+(live.attention?'red':live.active?'green':'')}>{live.attention?'Atenção':live.active?'Ativa':'Pausada'}</span></header>
   <div className="reference-panel-body"><dl className="sheets-summary">
    <dt>Aba</dt><dd>{c.sheetTitle}</dd>
    <dt>Gatilhos</dt><dd>{c.events.map(e=>sheetEvents[e]).join(', ')}</dd>
    <dt>Colunas</dt><dd>ID Cadence, {c.columns.map(k=>sheetColumns[k]).join(', ')}</dd>
    <dt>Última exportação</dt><dd>{live.lastSuccessAt?new Date(live.lastSuccessAt).toLocaleString('pt-BR'):'Nenhuma ainda'}</dd>
    <dt>Na fila</dt><dd>{live.queue?.pending??0}{live.queue?.failed?` · ${live.queue.failed} com falha`:''}</dd>
   </dl>
   {!!live.queue?.failed&&!live.attention&&canManage&&<Button type="button" disabled={busy} onClick={()=>void act('retry','As exportações com falha voltaram para a fila.')}>Tentar as falhas de novo</Button>}
   <div className="form-actions">{canManage&&<><Button type="button" disabled={busy} onClick={()=>void act(live.active?'pause':'activate',live.active?'Exportação pausada. Leads novos não entram na planilha.':'Exportação retomada.')}>{live.active?'Pausar':'Retomar'}</Button>
    <Button type="button" disabled={busy} onClick={()=>{setEditing(true);setMessage('');}}>Nova planilha</Button></>}{disconnect}</div></div></section>
 </div>;
}
function SheetsSetup({live,busy,canManage,onSubmit,onCancel}:{live:ConnectionView;busy:boolean;canManage:boolean;onSubmit:(input:{spreadsheetName:string;sheetTitle:string;columns:SheetColumn[];events:SheetEvent[]})=>void;onCancel?:()=>void}){
 const [name,setName]=useState('Prometeus Cadence — Leads'),[title,setTitle]=useState('Leads'),[columns,setColumns]=useState<SheetColumn[]>(live.config?.columns??defaultColumns),[events,setEvents]=useState<SheetEvent[]>(live.config?.events??['lead.created','lead.qualified','lead.connected']);
 const toggle=<T,>(list:T[],v:T)=>list.includes(v)?list.filter(x=>x!==v):[...list,v];
 const valid=name.trim()&&/^[\p{L}\p{N} _-]+$/u.test(title.trim())&&columns.length&&events.length;
 if(!canManage)return <section className="reference-panel sheets-config"><div className="reference-panel-body"><p className="muted">A conta Google está conectada. Somente proprietário ou administrador escolhe a planilha.</p></div></section>;
 return <section className="reference-panel sheets-config"><header><Icon name="Sheet" size={18}/><div className="grow"><h2>Escolher planilha</h2><p>O Prometeus cria a planilha na sua conta Google e escreve uma linha por lead.</p></div></header>
  <form className="reference-panel-body stack" onSubmit={e=>{e.preventDefault();if(valid)onSubmit({spreadsheetName:name.trim(),sheetTitle:title.trim(),columns,events});}}>
   <Field label="Nome da planilha"><input value={name} maxLength={100} disabled={busy} onChange={e=>setName(e.target.value)}/></Field>
   <Field label="Nome da aba"><input value={title} maxLength={50} disabled={busy} onChange={e=>setTitle(e.target.value)} aria-describedby="sheets-title-hint"/></Field>
   <small id="sheets-title-hint" className="muted">Letras, números, espaços, hífen e sublinhado.</small>
   <fieldset className="webhook-events sheets-columns"><legend>Colunas</legend><p className="muted">A coluna A, “ID Cadence”, identifica o lead e evita linhas repetidas. Não a apague nem a renomeie.</p>
    {(Object.keys(sheetColumns) as SheetColumn[]).map(k=><label key={k}><input type="checkbox" checked={columns.includes(k)} disabled={busy} onChange={()=>setColumns(toggle(columns,k))}/><span>{sheetColumns[k]}</span></label>)}</fieldset>
   <fieldset className="webhook-events"><legend>Gatilhos</legend>{(Object.keys(sheetEvents) as SheetEvent[]).map(k=><label key={k}><input type="checkbox" checked={events.includes(k)} disabled={busy} onChange={()=>setEvents(toggle(events,k))}/><span>{sheetEvents[k]}</span></label>)}
    <small className="muted">Cada lead tem uma linha: um evento novo atualiza a mesma linha. Leads que já existiam não são copiados.</small></fieldset>
   <div className="form-actions">{onCancel&&<Button type="button" disabled={busy} onClick={onCancel}>Cancelar</Button>}<Button type="submit" variant="primary" disabled={busy||!valid}>{busy?'Criando a planilha…':'Criar planilha'}</Button></div>
  </form></section>;
}
