import { LinkedinSdr } from "@/modules/settings/linkedin-sdr";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { requirePrincipal } from "@/server/auth/principal";
import { readLinkedinCapabilities } from "@/server/linkedin/capabilities";
import { readLinkedinAccount } from "@/server/linkedin/connections";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<{ linkedin?: string }>;
}) {
  const section = (await params).section?.join("/") || "dashboard";
  if (!["dashboard", "campaigns", "campaigns/new", "people", "pipeline", "enrichment", "approvals", "cadences", "templates"].includes(section)) notFound();
  // The layout already resolved the principal (and redirects on failure); demo mode has no database.
  // shortcut: any failure here (session expired mid-render, DB down) shows the generic pending notice; the layout handles redirects.
  const view = process.env.APP_DATA_MODE === "demo" ? null : await requirePrincipal(await headers()).then(p => Promise.all([readLinkedinCapabilities(p), readLinkedinAccount(p)])).catch(() => null);
  const returned = (await searchParams).linkedin;
  return <LinkedinSdr key={section} section={section} availability={view && { reason: view[0].reason, connect: view[0].capabilities.connect, account: view[1].account, returned: section === "dashboard" ? returned : undefined }} />;
}
