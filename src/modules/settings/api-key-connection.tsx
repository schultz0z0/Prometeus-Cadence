"use client";
import { SelectField } from "@/components/ui/select-field";
import {useState} from 'react';
import type {ApiKeyProvider,ApiKeyView} from '@/domain/ai-routing';
import type {ProspectingClient} from '@/client/prospecting-client';
import {Button,Field,Notice,Badge,Modal} from '@/components/ui/primitives';
const names:Record<ApiKeyProvider,{title:string;where:string}>={openai:{title:'OpenAI API',where:'platform.openai.com → API keys'},gemini:{title:'Google Gemini API',where:'aistudio.google.com → Get API key'}};
export function ApiKeyConnection({provider,view,envConfigured,client,canManage,busy,act,onUpdate}:{provider:ApiKeyProvider;view:ApiKeyView|null;envConfigured:boolean;client:ProspectingClient;canManage:boolean;busy:boolean;act:(fn:()=>Promise<void>)=>Promise<void>;onUpdate:()=>Promise<void>}){
 const [key,setKey]=useState(''),[model,setModel]=useState(view?.model??''),[remove,setRemove]=useState(false),revision=view?.revision??0,name=names[provider];
 const save=(body:{key?:string;model?:string})=>act(async()=>{const next=await client.saveAiKey({provider,expectedRevision:revision,...body});setKey('');setModel(next?.model??'');await onUpdate();});
 return <section className="panel panel-pad stack section-gap"><div className="row between wrap"><h2>{name.title}</h2><Badge tone={view?.model?'green':'neutral'}>{view?(view.model?'Chave cadastrada':'Escolha o modelo'):envConfigured?'Chave do servidor':'Sem chave'}</Badge></div>
 <p>Cole a chave da API para usar este provedor em todos os workspaces. Ela é validada no provedor e guardada criptografada; depois de salva, não é exibida de novo.</p>
 {view&&<p>Chave terminada em ••••{view.hint} · atualizada em {new Date(view.updatedAt).toLocaleString('pt-BR')}</p>}
 {!view&&envConfigured&&<Notice>Este servidor já tem uma chave configurada no ambiente. Uma chave salva aqui passa a ter prioridade.</Notice>}
 {canManage?<>
  <form className="stack" onSubmit={e=>{e.preventDefault();if(key.trim())void save({key:key.trim()});}}><Field label={view?'Trocar chave':'Chave da API'}><input type="password" autoComplete="off" spellCheck={false} value={key} disabled={busy} onChange={e=>setKey(e.target.value)} placeholder={'Obtenha em '+name.where}/></Field>
  <div className="row wrap"><Button variant="primary" disabled={busy||key.trim().length<10}>{busy?'Validando…':'Validar e salvar chave'}</Button></div></form>
  {view&&<><Field label="Modelo"><SelectField value={model} disabled={busy} onChange={e=>setModel(e.target.value)}><option value="">Selecione um modelo</option>{view.models.map(m=><option key={m} value={m}>{m}</option>)}</SelectField></Field>
  <div className="row wrap"><Button disabled={busy||!model||model===view.model} onClick={()=>void save({model})}>Salvar modelo</Button><Button disabled={busy} onClick={()=>setRemove(true)}>Remover chave</Button></div></>}
 </>:<p className="muted">Somente administradores alteram a chave.</p>}
 <Notice>Depois de salvar a chave e o modelo, selecione “{name.title}” como LLM convencional, salve o roteamento e prepare o teste. O consumo é cobrado pelo provedor na conta dona da chave.</Notice>
 {remove&&<Modal title={'Remover chave '+name.title+'?'} onClose={()=>{if(!busy)setRemove(false);}}><div className="stack"><p>A chave salva será apagada. {envConfigured?'O provedor volta a usar a chave do ambiente do servidor.':'Novas gerações que usam este provedor ficam indisponíveis até outra chave ser cadastrada.'}</p><div className="row wrap"><Button disabled={busy} onClick={()=>setRemove(false)}>Voltar</Button><Button variant="primary" disabled={busy} onClick={()=>act(async()=>{await client.saveAiKey({provider,expectedRevision:revision,remove:true});setRemove(false);await onUpdate();})}>Confirmar remoção</Button></div></div></Modal>}
 </section>;
}
