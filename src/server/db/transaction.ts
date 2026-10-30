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
  try{return await withClientContextTransaction(client,principal,fn);}finally{client.release();}
}
// A caller holding a session-scoped lock may reuse the client between short
// transactions; membership locks still end before storage/network I/O.
export async function withClientContextTransaction<T>(client:PoolClient,principal:Principal,fn:(client:PoolClient)=>Promise<T>):Promise<T>{
  try {
    await client.query("BEGIN");
    const context = await client.query(
      "SELECT set_config('app.workspace_id',$1,true),set_config('app.user_id',$2,true),current_user AS database_role",
      [principal.workspaceId, principal.userId],
    );
    const membership = await client.query(
      "SELECT app.lock_membership() AS role",
    );
    if (!membership.rows[0]?.role)
      throw new AppError(403, "Você não tem mais acesso ao workspace.");
    // Interactive requests prove their current session. Background roles are
    // constrained by their own durable lease/fencing checks, not a browser token.
    if(context.rows[0]?.database_role==='cadence_app' && principal.sessionId){const proof=await client.query('SELECT app.second_factor_allowed($1) allowed',[principal.sessionId]);if(!proof.rows[0]?.allowed)throw new AppError(403,'Confirme o código do autenticador para continuar.','TWO_FACTOR_REQUIRED');}
    principal = { ...principal, role: membership.rows[0].role };
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw translateError(e);
  }
}
