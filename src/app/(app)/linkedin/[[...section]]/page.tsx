import { LinkedinSdr } from "@/modules/settings/linkedin-sdr";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { requirePrincipal } from "@/server/auth/principal";
import { readLinkedinCapabilities } from "@/server/linkedin/capabilities";
export default async function Page({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const section = (await params).section?.join("/") || "dashboard";
  if (!["dashboard", "campaigns", "campaigns/new", "people", "pipeline", "enrichment", "approvals", "cadences", "templates"].includes(section)) notFound();
  // The layout already resolved the principal (and redirects on failure); demo mode has no database.
  const view = process.env.APP_DATA_MODE === "demo" ? null : await readLinkedinCapabilities(await requirePrincipal(await headers()));
  return <LinkedinSdr key={section} section={section} availability={view && { reason: view.reason, connect: view.capabilities.connect }} />;
}
