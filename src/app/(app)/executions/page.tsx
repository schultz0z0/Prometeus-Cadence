import { Executions } from "@/modules/reports/reports";
export default async function Page({searchParams}:{searchParams:Promise<{automationId?:string}>}) {
  const {automationId}=await searchParams;
  return <Executions automationId={automationId?.length&&automationId.length<=120?automationId:undefined}/>;
}
