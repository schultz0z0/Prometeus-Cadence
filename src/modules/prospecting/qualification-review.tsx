"use client";
import {useState} from 'react';
import {Button,Modal,Notice} from '@/components/ui/primitives';
export function QualificationReview({count,onClose,onApply}:{count:number;onClose:()=>void;onApply:()=>Promise<void>}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Modal title="Aplicar propostas selecionadas?" onClose={()=>{if(!busy)onClose();}}><div className="stack"><p>Atualizar {count} contatos com as alterações exibidas na revisão.</p><Notice>Se um campo ou o contexto mudou desde a preparação, todo o lote será rejeitado para preservar a edição humana.</Notice>{error&&<p role="alert" className="error-bar">{error}</p>}<div className="form-actions"><Button disabled={busy} onClick={onClose}>Voltar</Button><Button variant="primary" disabled={busy} onClick={async()=>{if(busy)return;setBusy(true);try{await onApply();}catch(e){setError(e instanceof Error?e.message:'Falha ao aplicar.');}finally{setBusy(false);}}}>{busy?'Aplicando…':'Confirmar aplicação'}</Button></div></div></Modal>;
}
