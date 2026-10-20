import {JobProgress} from '@/modules/prospecting/job-progress';
export default async function Page({params}:{params:Promise<{id:string}>}){return <JobProgress id={(await params).id}/>;}
