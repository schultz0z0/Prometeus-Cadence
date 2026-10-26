import { AuthForm } from "@/modules/auth/form";
import {headers} from 'next/headers';import {redirect} from 'next/navigation';import {getAuth} from '@/server/auth/auth';
import {entryDestination} from '@/domain/registration';
export default async function Login({searchParams}:{searchParams:Promise<{next?:string}>}) {
  const next=entryDestination((await searchParams).next);
  if(process.env.APP_DATA_MODE!=='demo'){const result=await getAuth().api.getSession({headers:await headers()});if(result?.user.emailVerified)redirect(result.user.registrationRequired?'/onboarding/profile?next='+encodeURIComponent(next):next);}
  return (
    <AuthForm
      mode="login"
      next={next}
      localMail={process.env.SMTP_HOST==='127.0.0.1'||process.env.SMTP_HOST==='localhost'}
      google={Boolean(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
      )}
    />
  );
}
