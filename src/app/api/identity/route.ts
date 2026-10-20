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
    const input = JSON.parse(text);
    if (
      ["rename", "invite", "remove", "role"].includes(input?.type) &&
      !request.headers.get("x-cadence-workspace")
    )
      throw new AppError(
        422,
        "Informe o workspace exibido antes de administrar.",
      );
    return Response.json(await identityAction(request.headers, input), {
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
