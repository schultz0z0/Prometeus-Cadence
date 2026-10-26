import { AuthForm } from "@/modules/auth/form";
import {entryDestination} from '@/domain/registration';
export default async function Verify({searchParams}:{searchParams:Promise<{error?:string;next?:string}>}) {
  const query=await searchParams;
  return <AuthForm mode="verify" next={entryDestination(query.next)} initialError={query.error?'O link de verificação é inválido ou expirou. Solicite outro link abaixo.':''} localMail={process.env.SMTP_HOST==='127.0.0.1'||process.env.SMTP_HOST==='localhost'}/>;
}
