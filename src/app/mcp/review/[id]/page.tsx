import { McpReview } from "@/modules/settings/mcp-review";
export default async function McpReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <McpReview id={id} />;
}
