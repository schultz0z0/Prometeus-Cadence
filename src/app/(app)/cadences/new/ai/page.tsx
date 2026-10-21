import { CadenceWizard } from "@/modules/cadences/cadence-wizard";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ list?: string; channel?: string; product?:string;job?:string }>;
}) {
  const params = await searchParams;
  return (
    <CadenceWizard initialList={params.list} initialChannel={params.channel} initialProduct={params.product} initialJob={params.job}/>
  );
}
