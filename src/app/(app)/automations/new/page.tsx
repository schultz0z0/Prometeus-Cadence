import { ManualWizard } from "@/modules/automations/manual-wizard";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  return <ManualWizard initialSource={(await searchParams).source} />;
}
