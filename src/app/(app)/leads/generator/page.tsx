import {Generator} from '@/modules/prospecting/generator';
export default async function Page({searchParams}:{searchParams:Promise<{source?:string}>}){return <Generator initialSource={(await searchParams).source}/>;}
