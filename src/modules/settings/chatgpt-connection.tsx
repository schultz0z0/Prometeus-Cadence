"use client";
import {useState} from 'react';
import type {ChatGptOAuthView} from '@/domain/chatgpt-oauth';
import type {ProspectingClient} from '@/client/prospecting-client';
import {Button,Field,Notice,Badge,Modal} from '@/components/ui/primitives';
export function ChatgptConnection({view,client,canManage,busy,act,onUpdate}:{view:ChatGptOAuthView;client:ProspectingClient;canManage:boolean;busy:boolean;act:(fn:()=>Promise<void>)=>Promise<void>;onUpdate:()=>Promise<void>}){
 const [model,setModel]=useState(view.model),[disconnect,setDisconnect]=useState(false);
 return <section className="panel panel-pad stack section-gap"><div className="row between wrap"><h2>ChatGPT · OAuth direto</h2><Badge tone={view.state==='connected'?'green':'neutral'}>{view.state==='connected'?'Conta conectada':view.state==='attention'?'Requer atenção':'Não conectado'}</Badge></div>
 <p>Conecte a conta administrativa ChatGPT nesta instalação local. O app usa os modelos e a cota disponibilizados pela conta, sem precisar instalar o Codex CLI.</p>
 {!view.available?<Notice>A conexão direta está disponível no ambiente local em 127.0.0.1. A oferta comercial hospedada depende de habilitação própria na OpenAI.</Notice>:<>
 {view.email&&<p>Conta: {view.email}</p>}
 {view.lastError&&<Notice>{view.lastError==='CHATGPT_PLAN_PERMISSION_REQUIRED'?'O login foi salvo, mas faltou conceder o uso dos modelos pelo plano ChatGPT. Reconecte e revise as permissões.':view.lastError==='CHATGPT_CATALOG_UNAVAILABLE'?'A autorização foi salva, mas o catálogo de modelos não está disponível. Autorize novamente quando o serviço estiver disponível.':view.lastError==='CHATGPT_REMOTE_REVOCATION_UNCONFIRMED'?'A conexão local foi removida. A revogação remota não foi confirmada; confira os aplicativos conectados na sua conta ChatGPT.':'A conexão precisa ser autorizada novamente.'}</Notice>}
 {view.state==='connected'&&<><Field label="Modelo da conta"><select value={model} disabled={busy||!canManage} onChange={e=>setModel(e.target.value)}>{!view.models.length&&<option value="">Nenhum modelo disponível nesta conta</option>}{view.models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></Field><p className="muted">O catálogo não garante cota disponível. Use o teste revisado abaixo para verificar uma inferência.</p></>}
 {canManage&&<div className="row wrap"><Button variant="primary" disabled={busy} onClick={()=>act(async()=>{const result=await client.connectChatgpt(view.revision);const url=new URL(result.url);if(url.origin!=='https://auth.openai.com'||url.pathname!=='/api/accounts/authorize')throw Error('Endereço de autorização inválido.');location.assign(url.href);})}>{view.state==='disconnected'?'Conectar com ChatGPT':'Autorizar novamente'}</Button>
 {view.state==='connected'&&<Button disabled={busy||!model||model===view.model} onClick={()=>act(async()=>{await client.selectChatgptModel(view.revision,model);await onUpdate();})}>Salvar modelo</Button>}
 {view.state!=='disconnected'&&<Button disabled={busy} onClick={()=>setDisconnect(true)}>Desconectar ChatGPT</Button>}</div>}
 <Notice>Após conectar, selecione “ChatGPT · OAuth direto” como LLM convencional, salve o roteamento e prepare o teste. Conectar a conta não inicia gerações. Se a cota acabar, a execução para e não troca para uma API paga.</Notice>
 </>}
 {disconnect&&<Modal title="Desconectar ChatGPT?" onClose={()=>{if(!busy)setDisconnect(false);}}><div className="stack"><p>Os tokens desta conexão serão removidos. Novas gerações de todos os clientes que usam esta rota ficarão indisponíveis até a configuração de outra LLM convencional.</p><div className="row wrap"><Button disabled={busy} onClick={()=>setDisconnect(false)}>Voltar</Button><Button variant="primary" disabled={busy} onClick={()=>act(async()=>{await client.disconnectChatgpt(view.revision);setDisconnect(false);await onUpdate();})}>Confirmar desconexão</Button></div></div></Modal>}
 </section>;
}
