"use client";
import {useState} from 'react';
import {Field,Modal} from '@/components/ui/primitives';
import {legalDocuments,type LegalDocumentKind} from '@/domain/legal-documents';
import {LegalDocument} from './legal-document';
export function RegistrationFields({phone,onPhone,accepted,onAccepted,part='all'}:{phone:string;onPhone:(value:string)=>void;accepted:boolean;onAccepted:(value:boolean)=>void;part?:'phone'|'accept'|'all'}) {
 const [document,setDocument]=useState<LegalDocumentKind|null>(null);
 return <>{part!=='accept'&&<Field label="Telefone" help="Com DDD. Contato de cadastro; não conecta o WhatsApp."><input type="tel" autoComplete="tel" placeholder="(11) 98765-4321" maxLength={32} required value={phone} onChange={e=>onPhone(e.target.value)}/></Field>}{part!=='phone'&&<div className="registration-legal"><label><input type="checkbox" required checked={accepted} onChange={e=>onAccepted(e.target.checked)}/><span>Li e concordo com os <button type="button" onClick={()=>setDocument('terms')}>Termos de Uso</button> e a <button type="button" onClick={()=>setDocument('privacy')}>Política de Privacidade</button>.</span></label><small>Documentos provisórios de homologação. Este aceite não autoriza marketing nem envios.</small></div>}{document&&<Modal title={legalDocuments[document].title} onClose={()=>setDocument(null)}><LegalDocument kind={document}/><a href={legalDocuments[document].href} target="_blank" rel="noreferrer">Abrir documento em outra aba</a></Modal>}</>;
}
