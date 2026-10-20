import {ContactsTable} from '@/modules/contacts/contacts-table';
export default async function Page({searchParams}:{searchParams:Promise<{list?:string}>}){const p=await searchParams;return <ContactsTable initialList={p.list}/>;}
