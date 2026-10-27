"use client";
import {useEffect,useState} from 'react';
import {useLiveRefresh} from '@/client/use-live-refresh';
import {useProspecting,useIdentity} from '@/client/workspace-provider';
import type {AiSettingsView} from '@/domain/ai-routing';
import type {ProviderCapabilities} from '@/domain/prospecting';
import {Badge,Notice} from '@/components/ui/primitives';
export function ProviderStatus({compact=false}:{compact?:boolean}){
  const client=useProspecting(),admin=!!useIdentity()?.platformAiAdmin,[status,setStatus]=useState<ProviderCapabilities|null>(null),[error,setError]=useState(''),[ai,setAi]=useState<AiSettingsView|null>(null);
  useEffect(()=>{let active=true;Promise.all([client?.capabilities(),admin?client?.aiSettings():null]).then(([data,settings])=>{if(active){setStatus(data??null);setAi(settings??null);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[client,admin]);
  useLiveRefresh(async signal=>{if(!client)return;const [data,settings]=await Promise.all([client.capabilities(),admin?client.aiSettings():null]);if(!signal.aborted){setStatus(data);setAi(settings);setError('');}},15000,!!client,client);
  if(!client)return null;if(error)return <p role="alert">{error}</p>;if(!status)return <p role="status" className="muted">Consultando integrações…</p>;
  return <section className={`panel panel-pad ${compact?'':'section-gap'}`} aria-label="Status dos provedores"><div className="row between wrap"><h3>Provedores de prospecção</h3><Badge tone={status.enabled?'green':'neutral'}>{status.enabled?'Execuções habilitadas':'Execuções externas desabilitadas'}</Badge></div>
    <div className="row wrap section-gap">{Object.entries(status.sources).map(([name,s])=><Badge key={name} tone={s.configured?'green':'neutral'}>{name} · {s.configured?'configuração encontrada':'configuração pendente'}</Badge>)}</div>
    <p className="secondary-text section-gap">{admin?<>{ai?.route?`IA: ${ai.route.effectiveMode==='hybrid'?'JEV + ':''}${ai.route.conventional.provider} · ${ai.route.conventional.model}`:ai?.blockers.join(' ')} · <a href="/settings/ai">Administrar IA da plataforma</a></>:<>IA gerenciada pela plataforma · {status.generation.configured?'configuração encontrada':'temporariamente indisponível'}. <a href="/settings/context">Personalizar contexto da empresa</a></>}</p>
    {!compact&&<Notice>As consultas respeitam os créditos e limites do seu plano. Revise o público e o consumo estimado antes de confirmar uma execução.</Notice>}
  </section>;
}
