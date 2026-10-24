'use client';
import {useEffect,useRef,useState} from 'react';import type {ChannelClient} from '@/client/channel-client';import type {OpenwaConnectionView} from '@/domain/openwa';import {startOpenwaPolling} from '@/client/openwa-flow';
import {Button,Notice} from '@/components/ui/primitives';
export function OpenwaQr({initial,client,onClose}:{initial:OpenwaConnectionView;client:ChannelClient;onClose:()=>void}){
 const [view,setView]=useState(initial),[qr,setQr]=useState<string|null>(null),[error,setError]=useState(''),[expired,setExpired]=useState(false);
 const closeRef=useRef(onClose);closeRef.current=onClose;
 useEffect(()=>startOpenwaPolling({connectionId:initial.connection.id,revision:initial.connection.revision,readStatus:()=>client.openwaStatus(initial.connection.id),readQr:()=>client.openwaQr(initial.connection.id,initial.connection.revision),onStatus:setView,onQr:setQr,onExpired:()=>setExpired(true),onError:error=>{if([401,403].includes((error as {status:number})?.status)){closeRef.current();return;}setError(error instanceof Error?error.message:'Não foi possível atualizar a conexão.');}}),[client,initial.connection.id,initial.connection.revision]);
 return <div className="stack openwa-pairing">
 {view.phase==='ready'?<><h3>WhatsApp conectado</h3><p>O número está pronto para mensagens revisadas, respeitando as autorizações e os limites.</p><Button variant="primary" onClick={onClose}>Concluir</Button></>:<>
 <p>No WhatsApp do número dedicado, abra <strong>Aparelhos conectados → Conectar aparelho</strong> e leia o QR Code.</p>
 <div className="openwa-qr" aria-live="polite">{qr?<img src={qr} width={280} height={280} alt="QR Code para conectar o WhatsApp" referrerPolicy="no-referrer"/>:<p role="status">{expired?'O tempo de pareamento terminou. Feche e use Reconectar para tentar novamente.':view.phase==='qr_ready'?'QR expirou. Aguardando atualização automática.':view.phase==='authenticating'?'Confirmando conexão com o telefone…':view.phase==='action_required'||view.phase==='failed'?'A conexão precisa de atenção. Feche e use Reconectar.':'Preparando conexão. O QR aparecerá aqui…'}</p>}</div>
 <small>O QR atualiza somente com esta janela aberta. Não compartilhe a imagem.</small>
 </>}{error&&<Notice tone="error">{error}</Notice>}
 </div>;
}
