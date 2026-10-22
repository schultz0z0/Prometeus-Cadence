'use client';
import {useRef,useState} from 'react';
import type {MailClient,MailDiagnostics} from '@/client/mail-client';
import {Button,Field,Notice} from '@/components/ui/primitives';
export function EmailDiagnostics({client,id}:{client:MailClient;id:string}){
 const [selector,setSelector]=useState(''),[result,setResult]=useState<MailDiagnostics|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),pending=useRef(false);
 const labels={observed:'Registro observado',missing:'Registro não encontrado',unverified:'Não verificado'};
 return <details><summary>Diagnóstico do domínio</summary><div className="stack section-gap"><Field label="Seletor DKIM (opcional)"><input value={selector} onChange={e=>{setSelector(e.target.value);setResult(null);}} placeholder="Seletor informado pelo provedor" maxLength={63}/></Field><div><Button disabled={busy} onClick={async()=>{if(pending.current)return;pending.current=true;setBusy(true);setError('');try{setResult(await client.diagnose(id,selector||undefined));}catch(error){setError(error instanceof Error?error.message:'Falha na consulta DNS.');}finally{pending.current=false;setBusy(false);}}}>{busy?'Consultando…':'Consultar DNS'}</Button></div>
 {error&&<p role="alert">{error}</p>}{result&&<div role="status"><p>SPF: {labels[result.spf]} · DKIM: {labels[result.dkim]} · DMARC: {labels[result.dmarc]}</p><p>Alinhamento: não verificado.</p>{result.notes.map(note=><Notice key={note}>{note}</Notice>)}</div>}</div></details>;
}
