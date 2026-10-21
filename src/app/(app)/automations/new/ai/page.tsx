import { AudienceWizard } from "@/modules/automations/audience-wizard";
export default async function Page({searchParams}:{searchParams:Promise<{job?:string}>}) {
  return <AudienceWizard initialJob={(await searchParams).job}/>;
}
