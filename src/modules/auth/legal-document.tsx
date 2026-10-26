import { findLegalDocument, type LegalDocumentKind } from '@/domain/legal-documents';
export function LegalDocument({kind,version}:{kind:LegalDocumentKind;version?:string}) {
 const document=findLegalDocument(kind,version);if(!document)return null;
 return <article className="legal-document"><p className="legal-version">Versão {document.version} · Documento provisório de homologação</p>{document.historic&&<p>Versão histórica. Novos cadastros utilizam a versão atual.</p>}{document.sections.map(([title,body])=><section key={title}><h3>{title}</h3><p>{body}</p></section>)}</article>;
}
