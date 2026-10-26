import Link from 'next/link';
import {LegalDocument} from '@/modules/auth/legal-document';
import {notFound} from 'next/navigation';import {findLegalDocument} from '@/domain/legal-documents';
export default async function Terms({searchParams}:{searchParams:Promise<{version?:string}>}){const {version}=await searchParams;if(!findLegalDocument('terms',version))notFound();return <main className="public-legal"><Link href="/register">← Voltar ao cadastro</Link><h1>Termos de Uso</h1><LegalDocument kind="terms" version={version}/></main>;}
