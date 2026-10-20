import { AuthForm } from "@/modules/auth/form";
import {headers} from 'next/headers';import {redirect} from 'next/navigation';import {getAuth} from '@/server/auth/auth';
export default async function Login() {
  if(process.env.APP_DATA_MODE!=='demo'){const result=await getAuth().api.getSession({headers:await headers()});if(result?.user.emailVerified)redirect('/dashboard');}
  return (
    <AuthForm
      mode="login"
      google={Boolean(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
      )}
    />
  );
}
