"use client";
import {useState} from 'react';
import {Button,Field,Modal,Notice} from '@/components/ui/primitives';

export async function factorPost(action:string,body:unknown){
 let r;try{r=await fetch('/api/security/two-factor/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});}catch{throw Error('Falha de conexão. Tente novamente.');}
 const data=await r.json();if(!r.ok)throw Error(data.message??'Não foi possível confirmar. Tente novamente.');return data;
}
type Setup={challengeId:string;uri:string;qr:string;backupCodes:string[]};
export function TwoFactorDialog({enabled,hasPassword,onClose,onEnabled}:{enabled:boolean;hasPassword:boolean;onClose:()=>void;onEnabled:()=>Promise<void>}){
 const[password,setPassword]=useState(''),[code,setCode]=useState(''),[setup,setSetup]=useState<Setup|null>(null),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[discard,setDiscard]=useState(false),[complete,setComplete]=useState(false);
 function close(){if(busy)return;if(setup&&!complete&&!saved){setDiscard(true);return;}onClose();}
 async function submit(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError('');try{
  if(enabled){await factorPost('disable',{password,code});setPassword('');setCode('');location.assign('/login');return;}
  if(!setup){setSetup(await factorPost('prepare',{password}));setPassword('');}
  else{await factorPost('verify',{challengeId:setup.challengeId,code});setCode('');setSetup(null);setComplete(true);await onEnabled();}
 }catch(e){setError(e instanceof Error?e.message:'Falha de conexão. Tente novamente.');}finally{setBusy(false);}}
 return <Modal title={enabled?'Desativar autenticador':'Ativar autenticador'} onClose={close} className="factor-dialog">
  {discard?<div className="stack"><Notice>Guarde os códigos de recuperação antes de fechar. Se descartar agora, o autenticador não será ativado.</Notice><Button onClick={()=>setDiscard(false)}>Voltar ao pareamento</Button><Button onClick={onClose}>Descartar pareamento</Button></div>:complete?<div className="stack"><Notice>Autenticador ativado. Nas próximas entradas, use o código do seu aplicativo ou um código de recuperação.</Notice><Button variant="primary" onClick={onClose}>Concluir</Button></div>:<form className="stack" onSubmit={submit}>
   {!setup?<><p>{enabled?'Confirme sua senha e um novo código do autenticador. Todos os dispositivos serão desconectados.':'Confirme sua identidade para configurar o autenticador nesta conta.'}</p>{hasPassword?<Field label="Senha atual"><input type="password" required maxLength={128} autoComplete="current-password" value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/></Field>:<Notice>Use uma entrada recente com Google. Se a sessão tiver mais de cinco minutos, entre novamente antes de configurar.</Notice>}</>:<>
    <p>Leia o QR Code no Google Authenticator, 1Password, Authy ou similar. Confirme em até cinco minutos.</p>
    <div className="factor-private factor-qr"><img src={setup.qr} width={260} height={260} alt="QR Code privado para parear seu autenticador"/><details><summary>Não consigo ler o QR Code</summary><p>Insira esta chave no aplicativo autenticador:</p><code>{new URL(setup.uri).searchParams.get('secret')}</code></details></div>
    <div className="factor-private factor-backups"><h3>Códigos de recuperação</h3><p>Guarde em um local seguro. Cada código funciona uma vez; eles só aparecem neste pareamento.</p><div>{setup.backupCodes.map(value=><code key={value}>{value}</code>)}</div></div>
    <label className="row"><input type="checkbox" checked={saved} onChange={e=>setSaved(e.target.checked)}/>Guardei meus códigos de recuperação</label>
   </>}
   {(setup||enabled)&&<Field label="Código do autenticador"><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={code} disabled={busy} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/></Field>}
   {error&&<p role="alert" className="auth-error">{error}</p>}
   <div className="form-actions"><Button variant="primary" disabled={busy||(hasPassword&&!setup&&!password)||((setup||enabled)&&code.length!==6)||(!!setup&&!saved)}>{busy?'Confirmando…':enabled?'Desativar e sair':setup?'Confirmar e ativar':'Continuar'}</Button>{setup&&<Button disabled={busy} onClick={()=>{setSetup(null);setCode('');setSaved(false);setError('');}}>Recomeçar pareamento</Button>}</div>
  </form>}
 </Modal>;
}
