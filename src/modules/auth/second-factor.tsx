"use client";
import {useState} from 'react';
import {Button,Field} from '@/components/ui/primitives';
import {factorPost} from '@/modules/settings/two-factor';
export function SecondFactorForm({next,onBack}:{next:string;onBack:()=>void}){
 const[backup,setBackup]=useState(false),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <form className="stack" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await factorPost('recovery',{code:code.trim(),backup});setCode('');location.assign(next);}catch(e){setError(e instanceof Error?e.message:'Falha de conexão. Tente novamente.');}finally{setBusy(false);}}}>
  <p>{backup?'Informe um dos códigos de recuperação guardados ao ativar o autenticador. Ele funciona uma única vez.':'Abra seu aplicativo autenticador e informe o código de seis dígitos.'}</p>
  <Field label={backup?'Código de recuperação':'Código do autenticador'}><input autoFocus autoComplete="one-time-code" inputMode={backup?'text':'numeric'} required minLength={6} maxLength={backup?32:6} pattern={backup?undefined:'[0-9]{6}'} value={code} onChange={e=>setCode(backup?e.target.value:e.target.value.replace(/\D/g,''))} disabled={busy}/></Field>
  {error&&<p className="auth-error" role="alert">{error}</p>}
  <Button variant="primary" disabled={busy||code.trim().length<6}>{busy?'Verificando…':'Confirmar e entrar'}</Button>
  <Button type="button" disabled={busy} onClick={()=>{setBackup(!backup);setCode('');setError('');}}>{backup?'Usar aplicativo autenticador':'Usar código de recuperação'}</Button>
  <Button type="button" disabled={busy} onClick={onBack}>Voltar para o login</Button>
 </form>;
}
