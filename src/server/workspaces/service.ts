import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPools } from "../db/pool.ts";
import { requireIdentity, requirePrincipal } from "../auth/principal.ts";
import { AppError } from "../errors.ts";
import { sendLocalMail } from "../auth/mail.ts";
const id = z.string().min(1).max(120),
  role = z.enum(["admin", "operator"]);
const actionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("create"),
    requestId: z.uuid(),
    name: z.string().trim().min(2).max(100),
  }),
  z.strictObject({ type: z.literal("switch"), workspaceId: id }),
  z.strictObject({
    type: z.literal("invite"),
    email: z.email().max(254),
    role,
  }),
  z.strictObject({ type: z.literal("accept"), invitationId: id }),
  z.strictObject({ type: z.literal("role"), memberId: id, role }),
  z.strictObject({ type: z.literal("remove"), memberId: id }),
  z.strictObject({
    type: z.literal("rename"),
    name: z.string().trim().min(2).max(100),
  }),
]);
export async function identitySnapshot(headers: Headers) {
  const { user, session } = await requireIdentity(headers);
  const pool = getPools().authPool;
  const workspaces = (
    await pool.query(
      'SELECT o.id,o.name,m.role FROM organization o JOIN member m ON m."organizationId"=o.id WHERE m."userId"=$1 ORDER BY o."createdAt"',
      [user.id],
    )
  ).rows as { id: string; name: string; role: string }[];
  const active = workspaces.find((w) => w.id === session.activeOrganizationId);
  const members = active
    ? ((
        await pool.query(
          'SELECT m.id,m."userId",m.role,u.name,u.email FROM member m JOIN "user" u ON u.id=m."userId" WHERE m."organizationId"=$1',
          [active.id],
        )
      ).rows as {
        id: string;
        userId: string;
        role: string;
        name: string;
        email: string;
      }[])
    : [];
  const invitations =
    active && active.role !== "operator"
      ? (
          await pool.query(
            'SELECT id,email,role,status,"expiresAt" FROM invitation WHERE "organizationId"=$1 AND status=\'pending\' AND "expiresAt">now()',
            [active.id],
          )
        ).rows
      : [];
  return {
    user: { id: user.id, name: user.name, email: user.email },
    activeWorkspaceId: active?.id ?? null,
    workspaces,
    members,
    invitations,
  };
}
export async function identityAction(
  headers: Headers,
  input: unknown,
): Promise<{ workspaceId?: string; id?: string }> {
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) throw new AppError(422, "Dados de workspace inválidos.");
  const action = parsed.data;
  const { user, session } = await requireIdentity(headers);
  const client = await getPools().authPool.connect();
  let invitationMail: { email: string; id: string; name: string } | undefined;
  try {
    await client.query("BEGIN");
    // Serialize membership changes and provisioning for an actor; target row locks
    // also serialize with domain transactions holding app.lock_membership().
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [user.id]);
    if (action.type === "create") {
      const old = (
        await client.query(
          "SELECT workspace_id FROM workspace_request WHERE user_id=$1 AND request_id=$2",
          [user.id, action.requestId],
        )
      ).rows[0];
      const workspaceId = old?.workspace_id ?? randomUUID();
      if (!old) {
        await client.query(
          'INSERT INTO organization(id,name,slug,"createdAt") VALUES($1,$2,$1,now())',
          [workspaceId, action.name],
        );
        await client.query(
          'INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,\'owner\',now())',
          [randomUUID(), workspaceId, user.id],
        );
        await client.query("INSERT INTO workspace_request VALUES($1,$2,$3)", [
          user.id,
          action.requestId,
          workspaceId,
        ]);
      }
      await client.query(
        'UPDATE session SET "activeOrganizationId"=$1 WHERE id=$2 AND "userId"=$3',
        [workspaceId, session.id, user.id],
      );
      await client.query("COMMIT");
      return { workspaceId };
    }
    if (action.type === "switch") {
      const member = (
        await client.query(
          'SELECT id FROM member WHERE "organizationId"=$1 AND "userId"=$2 FOR SHARE',
          [action.workspaceId, user.id],
        )
      ).rows[0];
      if (!member) throw new AppError(403, "Workspace indisponível.");
      await client.query(
        'UPDATE session SET "activeOrganizationId"=$1 WHERE id=$2',
        [action.workspaceId, session.id],
      );
      await client.query("COMMIT");
      return { workspaceId: action.workspaceId };
    }
    if (action.type === "accept") {
      const invite = (
        await client.query("SELECT * FROM invitation WHERE id=$1 FOR UPDATE", [
          action.invitationId,
        ])
      ).rows[0];
      if (
        !invite ||
        invite.email.toLowerCase() !== user.email.toLowerCase() ||
        invite.status !== "pending" ||
        new Date(invite.expiresAt) <= new Date() ||
        !["admin", "operator"].includes(invite.role)
      )
        throw new AppError(403, "Convite inválido ou vencido.");
      await client.query(
        'INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now()) ON CONFLICT ("organizationId","userId") DO NOTHING',
        [randomUUID(), invite.organizationId, user.id, invite.role],
      );
      await client.query(
        "UPDATE invitation SET status='accepted' WHERE id=$1",
        [invite.id],
      );
      await client.query(
        'UPDATE session SET "activeOrganizationId"=$1 WHERE id=$2',
        [invite.organizationId, session.id],
      );
      await client.query("COMMIT");
      return { workspaceId: invite.organizationId };
    }
    const p = await requirePrincipal(headers);
    const actor = (
      await client.query(
        'SELECT role FROM member WHERE "organizationId"=$1 AND "userId"=$2 FOR UPDATE',
        [p.workspaceId, user.id],
      )
    ).rows[0];
    if (!actor || actor.role === "operator")
      throw new AppError(403, "Seu papel não permite administrar o workspace.");
    if (action.type === "invite") {
      if (action.role === "admin" && actor.role !== "owner")
        throw new AppError(
          403,
          "Somente o proprietário convida administradores.",
        );
      const existing = (
        await client.query(
          'SELECT m.id FROM member m JOIN "user" u ON u.id=m."userId" WHERE m."organizationId"=$1 AND lower(u.email)=lower($2)',
          [p.workspaceId, action.email],
        )
      ).rows[0];
      if (existing) throw new AppError(409, "Este e-mail já é membro.");
      const inviteId = randomUUID();
      await client.query(
        'INSERT INTO invitation(id,"organizationId",email,role,status,"expiresAt","createdAt","inviterId") VALUES($1,$2,$3,$4,\'pending\',now()+interval \'48 hours\',now(),$5)',
        [
          inviteId,
          p.workspaceId,
          action.email.toLowerCase(),
          action.role,
          user.id,
        ],
      );
      const org = (
        await client.query("SELECT name FROM organization WHERE id=$1", [
          p.workspaceId,
        ])
      ).rows[0];
      invitationMail = { email: action.email, id: inviteId, name: org.name };
    } else if (action.type === "rename") {
      await client.query("UPDATE organization SET name=$1 WHERE id=$2", [
        action.name,
        p.workspaceId,
      ]);
    } else {
      const target = (
        await client.query(
          'SELECT * FROM member WHERE id=$1 AND "organizationId"=$2 FOR UPDATE',
          [action.memberId, p.workspaceId],
        )
      ).rows[0];
      if (!target) throw new AppError(404, "Membro não encontrado.");
      if (
        target.role === "owner" ||
        (actor.role !== "owner" &&
          (target.role !== "operator" ||
            (action.type === "role" && action.role !== "operator")))
      )
        throw new AppError(
          403,
          "Somente o proprietário pode alterar administradores; a titularidade é preservada.",
        );
      if (action.type === "remove")
        await client.query("DELETE FROM member WHERE id=$1", [target.id]);
      else
        await client.query("UPDATE member SET role=$1 WHERE id=$2", [
          action.role,
          target.id,
        ]);
    }
    await client.query(
      "INSERT INTO membership_audit(actor_id,workspace_id,action) VALUES($1,$2,$3)",
      [user.id, p.workspaceId, action.type],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  if (invitationMail) {
    const m = invitationMail;
    await sendLocalMail(
      m.email,
      `Convite — ${m.name}`,
      `Entre com o e-mail convidado e confirme o convite:\n${process.env.BETTER_AUTH_URL}/accept-invitation?id=${m.id}`,
    );
    return { id: m.id };
  }
  return {};
}
