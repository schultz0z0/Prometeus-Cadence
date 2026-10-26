import { LinkedinSdr } from "@/modules/settings/linkedin-sdr";
import { notFound } from "next/navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const section = (await params).section?.join("/") || "dashboard";
  if (!["dashboard", "campaigns", "campaigns/new", "people", "pipeline", "enrichment", "approvals", "cadences", "templates"].includes(section)) notFound();
  return <LinkedinSdr key={section} section={section} />;
}
