import { AuthForm } from "@/modules/auth/form";
import {entryDestination} from '@/domain/registration';
export default async function Register({searchParams}:{searchParams:Promise<{next?:string}>}) {
  const next=entryDestination((await searchParams).next);
  return (
    <AuthForm
      mode="register"
      next={next}
      localMail={process.env.SMTP_HOST==='127.0.0.1'||process.env.SMTP_HOST==='localhost'}
      google={Boolean(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
      )}
    />
  );
}
