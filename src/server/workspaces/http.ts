import { requirePrincipal, requireIdentity } from "../auth/principal.ts";
import { readWorkspaceSnapshot, executeWorkspaceCommand } from "./commands.ts";
import { AppError, checkOrigin, errorResponse } from "../errors.ts";
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {capabilities} from '../auth/permissions.ts';
import {workspaceTag} from '../../domain/workspace-tag.ts';
async function principalFor(request: Request) {
  const p = await requirePrincipal(request.headers);
  const expected = request.headers.get("x-cadence-workspace");
  if (expected && expected !== p.workspaceId)
    throw new AppError(409, "O workspace mudou. Recarregue antes de salvar.",'WORKSPACE_CHANGED');
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
    if(request.headers.has('if-none-match')){
      const tag=await withWorkspaceTransaction(p,async c=>{
        const row=(await c.query('SELECT revision,app.current_role() AS role FROM app.workspace_meta WHERE workspace_id=$1',[p.workspaceId])).rows[0];
        return row?workspaceTag(p.workspaceId,Number(row.revision),capabilities(row.role)):null;
      });
      if(tag&&request.headers.get('if-none-match')===tag)return new Response(null,{status:304,headers:{'cache-control':'no-store','etag':tag}});
    }
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
