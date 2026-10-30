import {redirect} from 'next/navigation';
import {headers} from 'next/headers';
import {getAuth} from '@/server/auth/auth';
import {entryDestination} from '@/domain/registration';
import {ProfileCompletion} from '@/modules/auth/profile-completion';
import {requireIdentity} from '@/server/auth/principal';import {AppError} from '@/server/errors';
export default async function Profile({searchParams}:{searchParams:Promise<{next?:string}>}){
 const destination=entryDestination((await searchParams).next),session=await getAuth().api.getSession({headers:await headers()});
 if(!session?.user.emailVerified)redirect('/login?next='+encodeURIComponent(destination));
 try{await requireIdentity(await headers());}catch(e){if(e instanceof AppError&&(e.status===401||e.status===403))redirect('/login?next='+encodeURIComponent(destination));throw e;}
 if(!session.user.registrationRequired)redirect(destination);
 return <ProfileCompletion next={destination}/>;
}
