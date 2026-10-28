'use client';
import {useEffect,useState} from 'react';
import type {DeliveryEvidence,PilotResult} from '@/domain/channel-evidence';
import {useMessaging} from '@/client/workspace-provider';
import {Button} from '@/components/ui/primitives';
import {useLiveRefresh} from '@/client/use-live-refresh';
const date=(value:string|null)=>value?new Date(value).toLocaleString('pt-BR'):'Sem confirmação';
const names:Record<string,string>={pending:'Na fila',dispatching:'Tentativa em andamento',accepted:'Aceita pelo provedor',delivered:'Entregue',read:'Lida',failed:'Falhou',uncertain:'Resultado incerto',cancelled:'Cancelada',blocked:'Bloqueada'};
export function DeliveryDetails({evidence,remoteId}:{evidence:DeliveryEvidence|null|undefined;remoteId?:string|null}){
 if(!evidence)return null;
 return <details className="email-technical"><summary>Comprovantes de envio</summary><p>Aceita pelo provedor: {date(evidence.acceptedAt)}</p>
 {evidence.supported.includes('delivered')?<p>Entrega: {date(evidence.deliveredAt)}</p>:<p>Entrega e leitura pelo destinatário: acompanhamento indisponível nesta integração.</p>}
 {evidence.supported.includes('read')&&<p>Leitura pelo destinatário: {date(evidence.readAt)}</p>}
 {remoteId&&<p>Referência do provedor: {remoteId}</p>}</details>;
}
export function ChannelTestEvidence({messageId,connectionId,recipient,canObserve=true}:{messageId:string;connectionId:string;recipient:string;canObserve?:boolean}){
 const client=useMessaging(),[evidence,setEvidence]=useState<DeliveryEvidence|null>(null),[result,setResult]=useState<PilotResult|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;client?.deliveryEvidence(messageId).then(v=>{if(active)setEvidence(v);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[client,messageId]);
 useLiveRefresh(async signal=>{if(!client||busy)return;const value=await client.deliveryEvidence(messageId);if(!signal.aborted)setEvidence(value);},5000,!!client,messageId);
 return <div className="stack"><p role="status">{evidence?names[evidence.state]??evidence.state:'Consultando resultado…'}</p><DeliveryDetails evidence={evidence}/>
 {canObserve&&<Button disabled={!client||busy} onClick={async()=>{setBusy(true);setError('');try{const value=await client!.observeTest(connectionId,messageId,recipient);setResult(value);setEvidence(value.delivery);}catch(e){setError(e instanceof Error?e.message:'Não foi possível conferir. Tente atualizar novamente.');}finally{setBusy(false);}}}>{busy?'Conferindo…':'Atualizar e registrar verificação'}</Button>}
 {result&&<p>{result.inboundId?'Resposta recebida nesta conversa.':'Aguardando uma resposta do destinatário para validar o retorno.'}{result.stoppedEnrollment?' Follow-up interrompido após a resposta.':''}</p>}
 {error&&<p role="alert">{error}</p>}</div>;
}
