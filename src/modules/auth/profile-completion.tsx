"use client";
import {useState} from 'react';
import Link from 'next/link';
import {RegistrationFields} from './registration-fields';
import {Button} from '@/components/ui/primitives';
import {LEGAL_VERSION} from '@/domain/legal-documents';
import {authClient} from '@/lib/auth-client';
export function ProfileCompletion({next}:{next:string}){
 const [phone,setPhone]=useState(''),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <main className="auth-content entry-workspace"><div className="auth-box"><Link href="/">◈ Prometeus Cadence</Link><h1>Complete seu cadastro</h1><p>Confirme seu contato e leia os documentos antes de continuar.</p><form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{const response=await fetch('/api/registration',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone,accepted,termsVersion:LEGAL_VERSION,privacyVersion:LEGAL_VERSION})});if(!response.ok)throw Error((await response.json()).message??'Não foi possível salvar.');location.assign(next);}catch(e){setError(e instanceof Error?e.message:'Falha de conexão.');}finally{setBusy(false);}}}><RegistrationFields phone={phone} onPhone={setPhone} accepted={accepted} onAccepted={setAccepted}/>{error&&<p role="alert" className="auth-error">{error}</p>}<Button variant="primary" disabled={busy||!phone||!accepted}>{busy?'Salvando…':'Salvar e continuar'}</Button></form><Button onClick={async()=>{await authClient.signOut();location.assign('/login?next='+encodeURIComponent(next));}}>Entrar com outra conta</Button></div></main>;
}
