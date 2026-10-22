'use client';
import {useState} from 'react';
export function UnsubscribeForm({token}:{token:string}){
 const [state,setState]=useState<'idle'|'pending'|'done'|'error'>('idle');
 async function submit(){setState('pending');try{const response=await fetch('/api/mail-unsubscribe/'+encodeURIComponent(token),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirm:true}),credentials:'omit',referrerPolicy:'no-referrer'});setState(response.ok?'done':'error');}catch{setState('error');}}
 return state==='done'?<p role="status">Solicitação recebida. Você pode fechar esta página.</p>:<div><button className="button primary" type="button" disabled={state==='pending'} onClick={()=>void submit()}>{state==='pending'?'Enviando…':'Confirmar descadastro'}</button>{state==='error'&&<p role="alert">Não foi possível registrar agora. Tente novamente.</p>}</div>;
}
