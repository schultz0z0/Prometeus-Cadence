import "server-only";
import type { PoolClient,Pool } from "pg";
import type { Principal } from "../../domain/workspace.ts";
import { getPools } from "./pool.ts";
import { AppError,translateError } from "../errors.ts";
export async function withWorkspaceTransaction<T>(
  principal: Principal,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withContextTransaction(getPools().appPool,principal,fn);
}
export async function withContextTransaction<T>(pool:Pool,principal:Principal,fn:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.workspace_id',$1,true),set_config('app.user_id',$2,true)",
      [principal.workspaceId, principal.userId],
    );
    const membership = await client.query(
      "SELECT app.lock_membership() AS role",
    );
    if (!membership.rows[0]?.role)
      throw new AppError(403, "Você não tem mais acesso ao workspace.");
    principal = { ...principal, role: membership.rows[0].role };
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw translateError(e);
  } finally {
    client.release();
  }
}
