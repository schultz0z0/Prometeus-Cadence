"use client";
import {useEffect,useState} from 'react';
import {useProspecting} from '@/client/workspace-provider';
import type {ProviderCapabilities} from '@/domain/prospecting';
import {Badge,Notice} from '@/components/ui/primitives';
export function ProviderStatus({compact=false}:{compact?:boolean}){
  const client=useProspecting(),[status,setStatus]=useState<ProviderCapabilities|null>(null),[error,setError]=useState('');
  useEffect(()=>{let active=true;client?.capabilities().then(data=>{if(active)setStatus(data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[client]);
  if(!client)return null;if(error)return <p role="alert">{error}</p>;if(!status)return <p role="status" className="muted">Consultando integrações…</p>;
  return <section className={`panel panel-pad ${compact?'':'section-gap'}`} aria-label="Status dos provedores"><div className="row between wrap"><h3>Provedores de prospecção</h3><Badge tone={status.enabled?'green':'neutral'}>{status.enabled?'Execuções habilitadas':'Execuções externas desabilitadas'}</Badge></div>
    <div className="row wrap section-gap">{Object.entries(status.sources).map(([name,s])=><Badge key={name} tone={s.configured?'green':'neutral'}>{name} · {s.configured?'configuração encontrada':'configuração pendente'}</Badge>)}</div>
    {!compact&&<><p className="secondary-text section-gap">JEV 1.13 · {status.decision.configured?'configuração encontrada':'chave pendente'} · Codex local · {status.generation.configured?'habilitado neste workspace de testes':'não habilitado neste workspace'}</p><Notice>Configuração encontrada não confirma saldo ou uma chamada bem-sucedida. Apollo busca empresas e pode consumir créditos; o Codex local usa a sessão ChatGPT do CLI. As execuções precisam do worker ativo.</Notice></>}
  </section>;
}
