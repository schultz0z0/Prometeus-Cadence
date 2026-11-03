"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useIdentity} from '@/client/workspace-provider';
import type {CalendarConfig,CalendarSlot,ConnectionView} from '@/domain/connector-capabilities';
import {Button,Field,Modal,Notice} from '@/components/ui/primitives';
import {Icon} from '@/components/ui/icon';
import {useConnectorApi,useConnections} from './apollo-connection';
const days=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const oauthNotice:Record<string,[string,'success'|'error']>={
 connected:['Conta Google conectada. Agora defina sua disponibilidade.','success'],
 failed:['O Google não concluiu a autorização. Tente conectar de novo.','error'],
 scope:['A autorização não incluiu ver a disponibilidade e criar eventos. Conecte de novo e marque as permissões pedidas.','error'],
};
type Rules=Omit<CalendarConfig,'calendarId'>;
function Header(){return <header><Link href="/settings/apps" aria-label="Voltar para CRM e apps"><Icon name="ArrowLeft" size={20}/></Link><span><Icon name="Calendar" size={22}/></span><div><h1>Google Agenda</h1><p>Disponibilidade para reuniões com leads</p></div></header>;}
const when=(iso:string,timeZone:string)=>new Date(iso).toLocaleString('pt-BR',{timeZone,weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
export function CalendarConnection(){
 const identity=useIdentity(),role=identity?.workspaces.find(w=>w.id===identity.activeWorkspaceId)?.role??'',canManage=['owner','admin'].includes(role),canRead=canManage||role==='operator';
 const api=useConnectorApi(),{items,error:loadError,load}=useConnections(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[editing,setEditing]=useState(false),[confirm,setConfirm]=useState(false);
 const [oauth,setOauth]=useState<string|null>(null),[slots,setSlots]=useState<CalendarSlot[]|null>(null);
 useEffect(()=>{const q=new URLSearchParams(window.location.search).get('oauth');if(q&&oauthNotice[q]){setOauth(q);window.history.replaceState(null,'',window.location.pathname);}},[]);
 const live=items?.find(c=>c.kind==='google-calendar')??null;
 async function run(fn:()=>Promise<unknown>,done?:string){setBusy(true);setError('');setMessage('');try{await fn();if(done)setMessage(done);}catch(e){setError((e as Error).message);}finally{setBusy(false);load();}}
 async function authorize(){setBusy(true);setError('');try{const r=await api<{authorizationUrl:string}>('/api/integrations',{action:'calendar-authorize'});window.location.assign(r.authorizationUrl);}catch(e){setError((e as Error).message);setBusy(false);}}
 const alerts=<>{oauth&&<div role={oauthNotice[oauth][1]==='error'?'alert':'status'}><Notice tone={oauthNotice[oauth][1]}>{oauthNotice[oauth][0]}</Notice></div>}{error&&<div role="alert"><Notice tone="error">{error}</Notice></div>}
  <p className="sr-only" role="status">{message}</p>{message&&<Notice tone="success">{message}</Notice>}</>;
 if(loadError)return <div className="reference-settings integration-google"><Header/><Notice tone="error">{loadError} <button type="button" className="text-button" onClick={load}>Tentar de novo</button></Notice></div>;
 if(!items)return <div className="reference-settings integration-google"><Header/><p role="status">Consultando a conexão…</p></div>;
 if(!live)return <div className="reference-settings integration-google"><Header/>{alerts}
  <section className="reference-panel"><span><Icon name="Calendar" size={30}/></span><h2>Conectar Google Agenda</h2><p>Conecte sua conta Google para consultar sua disponibilidade e reservar reuniões na sua agenda principal. O Prometeus vê os horários ocupados e cria somente os eventos das reuniões.</p>
   <Button variant="primary" icon="Link2" disabled={busy||!canManage} onClick={()=>void authorize()}>{busy?'Abrindo o Google…':'Conectar conta Google'}</Button>
   {!canManage&&<small>Somente proprietário ou administrador conecta o Google.</small>}</section></div>;
 const disconnect=<>{canManage&&<Button type="button" variant="ghost" disabled={busy} onClick={()=>setConfirm(true)}>Desconectar</Button>}
  {confirm&&<Modal title="Desconectar a Google Agenda?" onClose={()=>setConfirm(false)}><div className="stack"><p>O acesso guardado é apagado e nenhum horário novo é consultado ou reservado. As reuniões já criadas continuam na sua agenda. Para remover também a permissão no Google, use myaccount.google.com/permissions.</p>
   <div className="form-actions"><Button type="button" onClick={()=>setConfirm(false)}>Cancelar</Button><Button type="button" variant="danger" onClick={()=>{setConfirm(false);setEditing(false);setSlots(null);void run(()=>api(`/api/integrations/${live.id}/disconnect`,{expectedRevision:live.revision}),'Google Agenda desconectada.');}}>Desconectar</Button></div></div></Modal>}</>;
 if(!live.calendar||editing)return <div className="reference-settings integration-google"><Header/>{alerts}
  <CalendarSetup live={live} busy={busy} canManage={canManage} onCancel={live.calendar?()=>setEditing(false):undefined}
   onSubmit={input=>run(async()=>{await api('/api/integrations',{action:'calendar-configure',input:{...input,expectedRevision:live.configRevision??0}});setEditing(false);setSlots(null);},'Disponibilidade salva.')}/>
  <div className="form-actions sheets-footer">{disconnect}</div></div>;
 const c=live.calendar;
 const showSlots=()=>run(async()=>{const r=await api<{slots:CalendarSlot[]}>('/api/integrations',{action:'calendar-slots',input:{}});setSlots(r.slots);});
 return <div className="reference-settings integration-google"><Header/>{alerts}
  {live.attention&&<Notice tone="error">{live.lastError??'A agenda precisa de atenção.'} {canManage&&<Button type="button" disabled={busy} onClick={()=>void authorize()}>Reconectar conta Google</Button>}</Notice>}
  <section className="reference-panel sheets-config"><header><Icon name="Calendar" size={18}/><div className="grow"><h2>Agenda conectada</h2><p>Agenda principal da conta Google</p></div>
   <span className={'badge '+(live.attention?'red':'green')}>{live.attention?'Atenção':'Ativa'}</span></header>
   <div className="reference-panel-body"><dl className="sheets-summary">
    <dt>Fuso</dt><dd>{c.timezone}</dd>
    <dt>Dias</dt><dd>{c.weekdays.slice().sort().map(d=>days[d]).join(', ')}</dd>
    <dt>Horário</dt><dd>{c.start} às {c.end}</dd>
    <dt>Duração</dt><dd>{c.durationMinutes} min</dd>
    <dt>Antecedência mínima</dt><dd>{c.noticeHours} h</dd>
    <dt>Janela</dt><dd>{c.horizonDays} {c.horizonDays===1?'dia':'dias'}</dd>
   </dl>
   <small className="muted">A reserva automática de reuniões chega com o agente SDR. Os horários abaixo já descontam o que está ocupado na sua agenda.</small>
   {canRead&&!live.attention&&<div className="stack"><div><Button type="button" disabled={busy} onClick={()=>void showSlots()}>{slots?'Atualizar horários livres':'Ver horários livres'}</Button></div>
    {slots&&(slots.length?<ul className="calendar-slots" aria-label="Próximos horários livres">{slots.slice(0,8).map(s=><li key={s.start}>{when(s.start,c.timezone)}</li>)}</ul>:<p className="muted">Nenhum horário livre nos próximos 7 dias.</p>)}</div>}
   <div className="form-actions">{canManage&&<Button type="button" disabled={busy} onClick={()=>{setEditing(true);setMessage('');}}>Editar disponibilidade</Button>}{disconnect}</div></div></section>
 </div>;
}
function CalendarSetup({live,busy,canManage,onSubmit,onCancel}:{live:ConnectionView;busy:boolean;canManage:boolean;onSubmit:(input:Rules)=>void;onCancel?:()=>void}){
 const zones=typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('timeZone'):['America/Sao_Paulo'];
 const [rules,setRules]=useState<Rules>(()=>{const {calendarId,...r}=live.calendar??{calendarId:'primary',timezone:'America/Sao_Paulo',weekdays:[1,2,3,4,5],start:'09:00',end:'18:00',durationMinutes:30 as const,noticeHours:4,horizonDays:14};void calendarId;return r;});
 const set=<K extends keyof Rules>(k:K,v:Rules[K])=>setRules(r=>({...r,[k]:v}));
 const valid=rules.weekdays.length>0&&rules.start<rules.end&&rules.noticeHours>=0&&rules.noticeHours<=72&&rules.horizonDays>=1&&rules.horizonDays<=60;
 if(!canManage)return <section className="reference-panel sheets-config"><div className="reference-panel-body"><p className="muted">A conta Google está conectada. Somente proprietário ou administrador define a disponibilidade.</p></div></section>;
 return <section className="reference-panel sheets-config"><header><Icon name="Calendar" size={18}/><div className="grow"><h2>Disponibilidade</h2><p>Os horários livres seguem estas regras e descontam o que já está ocupado na sua agenda principal.</p></div></header>
  <form className="reference-panel-body stack" onSubmit={e=>{e.preventDefault();if(valid)onSubmit(rules);}}>
   <Field label="Fuso horário"><select value={rules.timezone} disabled={busy} onChange={e=>set('timezone',e.target.value)}>{(zones.includes(rules.timezone)?zones:[rules.timezone,...zones]).map(z=><option key={z} value={z}>{z}</option>)}</select></Field>
   <fieldset className="webhook-events calendar-days"><legend>Dias de atendimento</legend>{days.map((d,i)=><label key={d}><input type="checkbox" checked={rules.weekdays.includes(i)} disabled={busy} onChange={()=>set('weekdays',rules.weekdays.includes(i)?rules.weekdays.filter(x=>x!==i):[...rules.weekdays,i])}/><span>{d}</span></label>)}</fieldset>
   <div className="calendar-hours">
    <Field label="Início"><input type="time" value={rules.start} disabled={busy} onChange={e=>set('start',e.target.value)}/></Field>
    <Field label="Fim"><input type="time" value={rules.end} disabled={busy} onChange={e=>set('end',e.target.value)}/></Field>
    <Field label="Duração da reunião"><select value={rules.durationMinutes} disabled={busy} onChange={e=>set('durationMinutes',Number(e.target.value) as Rules['durationMinutes'])}>{[15,30,45,60].map(m=><option key={m} value={m}>{m} min</option>)}</select></Field>
    <Field label="Antecedência mínima (horas)"><input type="number" min={0} max={72} value={rules.noticeHours} disabled={busy} onChange={e=>set('noticeHours',Number(e.target.value))}/></Field>
    <Field label="Janela (dias)"><input type="number" min={1} max={60} value={rules.horizonDays} disabled={busy} onChange={e=>set('horizonDays',Number(e.target.value))}/></Field>
   </div>
   {rules.start>=rules.end&&<small className="muted" role="alert">O fim precisa ser depois do início.</small>}
   <div className="form-actions">{onCancel&&<Button type="button" disabled={busy} onClick={onCancel}>Cancelar</Button>}<Button type="submit" variant="primary" disabled={busy||!valid}>{busy?'Salvando…':'Salvar disponibilidade'}</Button></div>
  </form></section>;
}
