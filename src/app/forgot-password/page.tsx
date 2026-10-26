import { AuthForm } from "@/modules/auth/form";
import {entryDestination} from '@/domain/registration';
export default async function Forgot({searchParams}:{searchParams:Promise<{next?:string}>}) {
  return <AuthForm mode="forgot" next={entryDestination((await searchParams).next)} localMail={process.env.SMTP_HOST==='127.0.0.1'||process.env.SMTP_HOST==='localhost'}/>;
}
