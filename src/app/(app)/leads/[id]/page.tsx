import {LeadDetail} from '@/modules/contacts/lead-detail';
export default async function Page({params}:{params:Promise<{id:string}>}){return <LeadDetail id={(await params).id}/>;}
