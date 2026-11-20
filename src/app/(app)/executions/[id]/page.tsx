import {JobProgress} from '@/modules/prospecting/job-progress';
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){return <JobProgress id={(await params).id} technical={(await searchParams).detalhes==='1'}/>;}
