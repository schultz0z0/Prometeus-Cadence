import { AuthForm } from "@/modules/auth/form";
import {headers} from 'next/headers';import {redirect} from 'next/navigation';import {getAuth} from '@/server/auth/auth';
import {entryDestination} from '@/domain/registration';
import {requireIdentity} from '@/server/auth/principal';import {AppError} from '@/server/errors';
export default async function Login({searchParams}:{searchParams:Promise<{next?:string}>}) {
  const next=entryDestination((await searchParams).next);
  let pending=false;
  if(process.env.APP_DATA_MODE!=='demo'){const h=await headers(),result=await getAuth().api.getSession({headers:h});if(result?.user.emailVerified){let verified=false;try{await requireIdentity(h);verified=true;}catch(e){if(e instanceof AppError&&e.code==='TWO_FACTOR_REQUIRED')pending=true;else if(!(e instanceof AppError&&e.status===401))throw e;}if(verified)redirect(result.user.registrationRequired?'/onboarding/profile?next='+encodeURIComponent(next):next);}}
  return (
    <AuthForm
      mode="login"
      next={next}
      initialSecondFactor={pending}
      localMail={process.env.SMTP_HOST==='127.0.0.1'||process.env.SMTP_HOST==='localhost'}
      google={Boolean(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
      )}
    />
  );
}
