import { CadenceWizard } from "@/modules/cadences/cadence-wizard";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  return <CadenceWizard initialList={(await searchParams).list} />;
}
