import {redirect} from 'next/navigation';
import {headers} from 'next/headers';
import {getAuth} from '@/server/auth/auth';
import {entryDestination} from '@/domain/registration';
import {requireIdentity} from '@/server/auth/principal';import {AppError} from '@/server/errors';
export default async function Entry({searchParams}:{searchParams:Promise<{next?:string;error?:string}>}){
 const query=await searchParams,destination=entryDestination(query.next);
 if(query.error)redirect('/verify-email?error='+encodeURIComponent(query.error)+'&next='+encodeURIComponent(destination));
 const session=await getAuth().api.getSession({headers:await headers()});
 if(!session?.user.emailVerified)redirect('/login?next='+encodeURIComponent(destination));
 try{await requireIdentity(await headers());}catch(e){if(e instanceof AppError&&(e.status===401||e.status===403))redirect('/login?next='+encodeURIComponent(destination));throw e;}
 if(session.user.registrationRequired)redirect('/onboarding/profile?next='+encodeURIComponent(destination));
 redirect(destination);
}
