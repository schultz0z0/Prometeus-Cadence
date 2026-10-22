import {UnsubscribeForm} from '../../../modules/messages/unsubscribe-form.tsx';
export const metadata={title:'Parar de receber e-mails',referrer:'no-referrer' as const,robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{token:string}>}){const {token}=await params;return <main className="auth-page"><section className="auth-card"><h1>Parar de receber e-mails</h1><p>Confirme abaixo para solicitar o descadastro deste endereço.</p><UnsubscribeForm token={token}/></section></main>;}
