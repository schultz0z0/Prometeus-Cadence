import test, { after } from "node:test";
import assert from "node:assert/strict";
import { getPools } from "../../src/server/db/pool.ts";
import { withWorkspaceTransaction } from "../../src/server/db/transaction.ts";
import { identityAction } from "../../src/server/workspaces/service.ts";
import { requirePrincipal } from "../../src/server/auth/principal.ts";
import {
  executeWorkspaceCommand,
  readWorkspaceSnapshot,
} from "../../src/server/workspaces/commands.ts";
import { verifiedUser, resetRateLimits } from "./helpers.ts";
after(async () => getPools().close());
test("RLS denies foreign writes, clears context on rollback and app role cannot bypass auth", async () => {
  await resetRateLimits();
  const a = await verifiedUser(),
    b = await verifiedUser();
  const ah = new Headers({ cookie: a.cookie }),
    bh = new Headers({ cookie: b.cookie });
  await identityAction(ah, {
    type: "create",
    requestId: crypto.randomUUID(),
    name: "Tenancy A",
  });
  await identityAction(bh, {
    type: "create",
    requestId: crypto.randomUUID(),
    name: "Tenancy B",
  });
  const pa = await requirePrincipal(ah),
    pb = await requirePrincipal(bh);
  await assert.rejects(
    withWorkspaceTransaction(pa, (c) =>
      c.query("INSERT INTO app.list VALUES($1,$2,$3)", [
        pb.workspaceId,
        "foreign",
        "Denied",
      ]),
    ),
  );
  assert.equal(
    (
      await getPools().appPool.query(
        "SELECT nullif(current_setting('app.workspace_id',true),'') AS context",
      )
    ).rows[0].context,
    null,
  );
  await assert.rejects(
    getPools().appPool.query('SELECT email FROM auth."user"'),
  );
  const role = (
    await getPools().appPool.query(
      "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  assert.equal(role.rolsuper, false);
  assert.equal(role.rolbypassrls, false);
  await withWorkspaceTransaction(pa, (c) =>
    c.query("INSERT INTO app.list VALUES($1,$2,$3)", [
      pa.workspaceId,
      "local",
      "A only",
    ]),
  );
  assert.equal((await readWorkspaceSnapshot(pb)).data.lists.length, 0);
});
test("server rechecks downgraded roles; personal preferences stay personal; drafts cannot activate", async () => {
  await resetRateLimits();
  const owner = await verifiedUser(),
    operator = await verifiedUser();
  const oh = new Headers({ cookie: owner.cookie }),
    h = new Headers({ cookie: operator.cookie });
  await identityAction(oh, {
    type: "create",
    requestId: crypto.randomUUID(),
    name: "Capabilities",
  });
  const invite = await identityAction(oh, {
    type: "invite",
    email: operator.email,
    role: "admin",
  });
  await identityAction(h, { type: "accept", invitationId: invite.id });
  const stale = await requirePrincipal(h),
    p = await requirePrincipal(oh);
  const member = (
    await getPools().authPool.query(
      'SELECT id FROM member WHERE "organizationId"=$1 AND "userId"=$2',
      [p.workspaceId, stale.userId],
    )
  ).rows[0];
  await identityAction(oh, {
    type: "role",
    memberId: member.id,
    role: "operator",
  });
  await assert.rejects(
    executeWorkspaceCommand(stale, {
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      command: {
        type: "preferences.update",
        preferences: { company: "Unauthorized" },
      },
    }),
    { status: 403 },
  );
  await executeWorkspaceCommand(stale, {
    requestId: crypto.randomUUID(),
    expectedRevision: 0,
    command: {
      type: "preferences.update",
      preferences: { onboardingHidden: true },
    },
  });
  assert.equal(
    (await readWorkspaceSnapshot(p)).data.preferences.onboardingHidden,
    false,
  );
  assert.equal(
    (await readWorkspaceSnapshot(stale)).data.preferences.onboardingHidden,
    true,
  );
  const profile = (await readWorkspaceSnapshot(p)).data.companyProfile;
  await assert.rejects(
    executeWorkspaceCommand(stale, {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      command: { type: "context.approve", profile },
    }),
    { status: 403 },
  );
  await executeWorkspaceCommand(stale, {
    requestId: crypto.randomUUID(),
    expectedRevision: 1,
    command: {
      type: "context.saveDraft",
      profile: { ...profile, offer: "Human correction" },
    },
  });
  const approved = await executeWorkspaceCommand(p, {
    requestId: crypto.randomUUID(),
    expectedRevision: 2,
    command: {
      type: "context.approve",
      profile: { ...profile, version: 1, offer: "Human correction" },
    },
  });
  assert.equal(approved.snapshot.data.companyProfile.offer, "Human correction");
  assert.equal(approved.snapshot.data.companyProfile.version, 2);
});
