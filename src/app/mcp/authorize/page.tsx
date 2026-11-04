import { McpConsent } from "@/modules/settings/mcp-consent";
export default async function McpAuthorize({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const { request } = await searchParams;
  return <McpConsent requestId={request ?? ""} />;
}
