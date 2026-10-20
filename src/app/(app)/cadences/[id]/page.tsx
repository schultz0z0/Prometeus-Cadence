import {CadenceEditor} from '@/modules/cadences/cadence-editor';export default async function Page({params}:{params:Promise<{id:string}>}){return <CadenceEditor id={(await params).id}/>;}
