'use client';
import {useEffect,useRef,useState} from 'react';import type {ChannelClient} from '@/client/channel-client';import type {OpenwaConnectionView} from '@/domain/openwa';import {startOpenwaPolling,openwaPairingMessage} from '@/client/openwa-flow';
import {Button,Notice} from '@/components/ui/primitives';
export function OpenwaQr({initial,client,onClose}:{initial:OpenwaConnectionView;client:ChannelClient;onClose:()=>void}){
 const [view,setView]=useState(initial),[qr,setQr]=useState<string|null>(null),[error,setError]=useState(''),[expired,setExpired]=useState(false);
 const closeRef=useRef(onClose);closeRef.current=onClose;
 useEffect(()=>startOpenwaPolling({connectionId:initial.connection.id,revision:initial.connection.revision,readStatus:()=>client.openwaStatus(initial.connection.id),readQr:()=>client.openwaQr(initial.connection.id,initial.connection.revision),onStatus:setView,onQr:setQr,onExpired:()=>setExpired(true),onError:error=>{if([401,403].includes((error as {status:number})?.status)){closeRef.current();return;}setError(error instanceof Error?error.message:'Não foi possível atualizar a conexão.');}}),[client,initial.connection.id,initial.connection.revision]);
 return <div className="stack openwa-pairing">
 {view.phase==='ready'?<><h3>WhatsApp conectado</h3><p>O número está pronto para mensagens revisadas, respeitando as autorizações e os limites.</p><Button variant="primary" onClick={onClose}>Concluir</Button></>:<>
 {view.phase==='qr_ready'?<p>No WhatsApp, abra <strong>Aparelhos conectados → Conectar aparelho</strong> e leia o QR Code.</p>:<p>Se o aparelho continuar vinculado, a conexão volta sem precisar ler outro QR.</p>}
 <div className="openwa-qr" aria-live="polite">{qr?<img src={qr} width={280} height={280} alt="QR Code para conectar o WhatsApp" referrerPolicy="no-referrer"/>:<p role="status">{openwaPairingMessage(view.phase,expired)}</p>}</div>
 {['disconnected','failed','action_required'].includes(view.phase)||expired?<Button onClick={onClose}>Voltar</Button>:<small>O QR atualiza com esta janela aberta. Não compartilhe a imagem.</small>}
 </>}{error&&<Notice tone="error">{error}</Notice>}
 </div>;
}
