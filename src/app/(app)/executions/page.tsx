import { Executions } from "@/modules/reports/reports";
import { ExecutionDiary } from "@/modules/reports/execution-diary";

export default async function Page({searchParams}:{searchParams:Promise<{automationId?:string;view?:string}>}) {
  const {automationId,view}=await searchParams;
  const automation = typeof automationId==='string'&&automationId.length<=120?automationId:undefined;
  return view==='jobs'||automation ? <Executions automationId={automation}/> : <ExecutionDiary/>;
}
