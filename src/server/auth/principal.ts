import "server-only";
import { getAuth } from "./auth.ts";
import { getPools } from "../db/pool.ts";
import { AppError } from "../errors.ts";
import type { Principal, Role } from "../../domain/workspace.ts";
export async function requireIdentity(headers: Headers) {
  const result = await getAuth().api.getSession({ headers });
  if (!result) throw new AppError(401, "Sua sessão venceu. Entre novamente.");
  if (!result.user.emailVerified)
    throw new AppError(403, "Confirme seu e-mail para continuar.");
  const current = (
    await getPools().authPool.query(
      'SELECT "activeOrganizationId" FROM session WHERE id=$1 AND "userId"=$2 AND "expiresAt">now()',
      [result.session.id, result.user.id],
    )
  ).rows[0];
  if (!current) throw new AppError(401, "Sua sessão venceu. Entre novamente.");
  return {
    ...result,
    session: {
      ...result.session,
      activeOrganizationId: current.activeOrganizationId as string | null,
    },
  };
}
export async function requirePrincipal(headers: Headers): Promise<Principal> {
  const { user, session } = await requireIdentity(headers);
  if(user.registrationRequired) throw new AppError(403,'Complete seu cadastro para continuar.','REGISTRATION_REQUIRED');
  const workspaceId = session.activeOrganizationId;
  if (!workspaceId) throw new AppError(403, "Escolha um workspace.");
  const { rows } = await getPools().authPool.query(
    'SELECT role FROM member WHERE "userId"=$1 AND "organizationId"=$2',
    [user.id, workspaceId],
  );
  if (!rows[0] || !["owner", "admin", "operator"].includes(rows[0].role))
    throw new AppError(403, "Você não tem acesso a este workspace.");
  return {
    userId: user.id,
    workspaceId,
    role: rows[0].role as Role,
    sessionId: session.id,
  };
}
