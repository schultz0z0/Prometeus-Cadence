import test, { after } from "node:test";
import assert from "node:assert/strict";
import { getPools } from "../../src/server/db/pool.ts";
import {
  identityAction,
  identitySnapshot,
} from "../../src/server/workspaces/service.ts";
import { requirePrincipal } from "../../src/server/auth/principal.ts";
import { verifiedUser, resetRateLimits, mailLink } from "./helpers.ts";
const headers = (cookie: string) => new Headers({ cookie });
after(async () => getPools().close());
test("workspace provisioning is concurrent-safe and session cannot switch to a foreign workspace", async () => {
  await resetRateLimits();
  const a = await verifiedUser(),
    b = await verifiedUser();
  const h = headers(a.cookie);
  const requestId = crypto.randomUUID();
  const [one, two] = await Promise.all([
    identityAction(h, { type: "create", requestId, name: "Workspace A" }),
    identityAction(h, { type: "create", requestId, name: "Workspace A" }),
  ]);
  assert.equal(one.workspaceId, two.workspaceId);
  const p = await requirePrincipal(h);
  assert.equal(p.workspaceId, one.workspaceId);
  assert.equal(p.role, "owner");
  await assert.rejects(
    identityAction(headers(b.cookie), {
      type: "switch",
      workspaceId: p.workspaceId,
    }),
  );
  assert.equal((await identitySnapshot(h)).workspaces.length, 1);
});
test("invitations bind verified email, expire once, enforce roles and revoke access immediately", async () => {
  await resetRateLimits();
  const a = await verifiedUser(),
    b = await verifiedUser(),
    other = await verifiedUser();
  const h = headers(a.cookie),
    bh = headers(b.cookie);
  await identityAction(h, {
    type: "create",
    requestId: crypto.randomUUID(),
    name: "Roles",
  });
  const invite = await identityAction(h, {
    type: "invite",
    email: b.email,
    role: "operator",
  });
  assert.ok(await mailLink(b.email, "accept-invitation"));
  await assert.rejects(
    identityAction(headers(other.cookie), {
      type: "accept",
      invitationId: invite.id,
    }),
  );
  await identityAction(bh, { type: "accept", invitationId: invite.id });
  await assert.rejects(
    identityAction(bh, { type: "accept", invitationId: invite.id }),
  );
  await assert.rejects(
    identityAction(bh, { type: "invite", email: other.email, role: "admin" }),
  );
  const members = (await identitySnapshot(h)).members;
  const bm = members.find((m) => m.userId === b.user.id)!;
  const owner = members.find((m) => m.role === "owner")!;
  await identityAction(h, { type: "role", memberId: bm.id, role: "admin" });
  await assert.rejects(
    identityAction(bh, { type: "role", memberId: owner.id, role: "operator" }),
  );
  await assert.rejects(
    identityAction(h, { type: "remove", memberId: owner.id }),
  );
  await identityAction(h, { type: "remove", memberId: bm.id });
  await assert.rejects(requirePrincipal(bh));
  const expired = await identityAction(h, {
    type: "invite",
    email: other.email,
    role: "operator",
  });
  await getPools().authPool.query(
    "UPDATE invitation SET \"expiresAt\"=now()-interval '1 minute' WHERE id=$1",
    [expired.id],
  );
  await assert.rejects(
    identityAction(headers(other.cookie), {
      type: "accept",
      invitationId: expired.id,
    }),
  );
});
