import { Reports } from "@/modules/reports/reports";
import { notFound } from "next/navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const tab = (await params).tab;
  if (!["overview", "funnel", "negocios", "performance"].includes(tab)) notFound();
  return <Reports tab={tab} />;
}
