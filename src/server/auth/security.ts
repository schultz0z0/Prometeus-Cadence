import "server-only";
import { z } from "zod";
import { getPools } from "../db/pool.ts";
import { requireIdentity } from "./principal.ts";
import { AppError, checkOrigin, errorResponse } from "../errors.ts";
import{invalidateFactorChallenges}from'./two-factor-policy.ts';
export async function securityRequest(request: Request) {
  try {
    const { user, session } = await requireIdentity(request.headers);
    if (request.method === "GET") {
      const rows = (
        await getPools().authPool.query(
          'SELECT id,"createdAt","updatedAt","expiresAt","userAgent" FROM session WHERE "userId"=$1 AND "expiresAt">now() ORDER BY "updatedAt" DESC',
          [user.id],
        )
      ).rows;
      const factor=(await getPools().authPool.query('SELECT u."twoFactorEnabled" enabled,EXISTS(SELECT 1 FROM account a WHERE a."userId"=u.id AND a."providerId"=\'credential\' AND a.password IS NOT NULL) "hasPassword" FROM "user" u WHERE id=$1',[user.id])).rows[0];
      return Response.json(
        { sessions: rows.map((r) => ({ ...r, current: r.id === session.id })),factor },
        { headers: { "cache-control": "no-store" } },
      );
    }
    checkOrigin(request);
    const body = z
      .strictObject({ sessionId: z.string().min(1).max(120) })
      .safeParse(await request.json());
    if (!body.success) throw new AppError(422, "Sessão inválida.");
    const deleted = await getPools().authPool.query(
      'DELETE FROM session WHERE id=$1 AND "userId"=$2 RETURNING id',
      [body.data.sessionId, user.id],
    );
    if (!deleted.rowCount) throw new AppError(404, "Sessão não encontrada.");
    await invalidateFactorChallenges(getPools().authPool,user.id);
    return Response.json(
      { ok: true },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
