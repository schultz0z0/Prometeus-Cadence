import {Reports} from '@/modules/reports/reports';export default async function Page({params}:{params:Promise<{tab:string}>}){return <Reports tab={(await params).tab}/>;}
