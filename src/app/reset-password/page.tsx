import { AuthForm } from "@/modules/auth/form";
import {entryDestination} from '@/domain/registration';
export default async function Reset({
  searchParams,
}: {
  searchParams: Promise<{ token?: string;error?:string;next?:string }>;
}) {
  const { token,error,next } = await searchParams;
  return <AuthForm mode="reset" token={token} next={entryDestination(next)} initialError={error||!token?'Este link é inválido ou expirou. Solicite um novo link.':''}/>;
}
