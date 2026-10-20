import { identityAction, identitySnapshot } from "@/server/workspaces/service";
import { checkOrigin, errorResponse, AppError } from "@/server/errors";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    return Response.json(await identitySnapshot(request.headers), {
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const text = await request.text();
    if (text.length > 8192) throw new AppError(422, "Requisição muito grande.");
    return Response.json(
      await identityAction(request.headers, JSON.parse(text)),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
