import {WorkspaceSetup} from '@/modules/auth/workspace';
export default async function Accept({searchParams}:{searchParams:Promise<{id?:string}>}){const {id}=await searchParams;return <WorkspaceSetup invitationId={id??'invalid'}/>;}
