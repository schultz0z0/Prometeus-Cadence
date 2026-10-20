import { requirePrincipal, requireIdentity } from "../auth/principal.ts";
import { readWorkspaceSnapshot, executeWorkspaceCommand } from "./commands.ts";
import { AppError, checkOrigin, errorResponse } from "../errors.ts";
async function principalFor(request: Request) {
  const p = await requirePrincipal(request.headers);
  const expected = request.headers.get("x-cadence-workspace");
  if (expected && expected !== p.workspaceId)
    throw new AppError(409, "O workspace mudou. Recarregue antes de salvar.");
  return p;
}
async function personalize(
  headers: Headers,
  snapshot: Awaited<ReturnType<typeof readWorkspaceSnapshot>>,
) {
  const { user } = await requireIdentity(headers);
  snapshot.data.preferences.accountName = user.name;
  return snapshot;
}
export async function snapshotRequest(request: Request) {
  try {
    const p = await principalFor(request);
    return Response.json(
      await personalize(request.headers, await readWorkspaceSnapshot(p)),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function commandRequest(request: Request) {
  try {
    checkOrigin(request);
    if (Number(request.headers.get("content-length")) > 2097152)
      throw new AppError(422, "Importação limitada a 2 MB.");
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 2097152)
      throw new AppError(422, "Importação limitada a 2 MB.");
    const p = await principalFor(request);
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      throw new AppError(422, "Requisição inválida.");
    }
    const result = await executeWorkspaceCommand(p, input);
    result.snapshot = await personalize(request.headers, result.snapshot);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
