import test, { after } from "node:test";
import assert from "node:assert/strict";
import { getPools } from "../../src/server/db/pool.ts";
import { identityAction } from "../../src/server/workspaces/service.ts";
import { requirePrincipal } from "../../src/server/auth/principal.ts";
import {
  executeWorkspaceCommand,
  readWorkspaceSnapshot,
} from "../../src/server/workspaces/commands.ts";
import { verifiedUser, resetRateLimits } from "./helpers.ts";
after(async () => getPools().close());
async function workspace() {
  const u = await verifiedUser();
  const h = new Headers({ cookie: u.cookie });
  await identityAction(h, {
    type: "create",
    requestId: crypto.randomUUID(),
    name: "Commands test",
  });
  return requirePrincipal(h);
}
const lead = (id: string, listId: string) => ({
  id,
  listId,
  name: "Real saved contact",
  qualification: "pending",
  source: "MANUAL",
  createdAt: new Date().toISOString(),
});
test("normalized rows isolate same IDs, transaction context resets and foreign list cannot be referenced", async () => {
  await resetRateLimits();
  const a = await workspace(),
    b = await workspace();
  assert.equal((await readWorkspaceSnapshot(a)).data.leads.length, 0);
  const cmd = {
    requestId: crypto.randomUUID(),
    expectedRevision: 0,
    command: {
      type: "leads.import",
      leads: [lead("same", "list")],
      list: { id: "list", name: "A list" },
    },
  };
  await executeWorkspaceCommand(a, cmd);
  await executeWorkspaceCommand(b, {
    ...cmd,
    requestId: crypto.randomUUID(),
    command: { ...cmd.command, list: { id: "list", name: "B list" } },
  });
  assert.equal((await readWorkspaceSnapshot(a)).data.lists[0].name, "A list");
  assert.equal((await readWorkspaceSnapshot(b)).data.lists[0].name, "B list");
  assert.equal(
    (await getPools().appPool.query("SELECT * FROM app.lead")).rowCount,
    0,
  );
  await assert.rejects(
    executeWorkspaceCommand(a, {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      command: { type: "lead.upsert", lead: lead("bad", "foreign-list") },
    }),
  );
  assert.equal((await readWorkspaceSnapshot(a)).revision, 1);
  await getPools().authPool.query(
    'DELETE FROM member WHERE "organizationId"=$1 AND "userId"=$2',
    [a.workspaceId, a.userId],
  );
  await assert.rejects(readWorkspaceSnapshot(a));
});
test("audience confirmation is atomic, concurrent-safe and idempotent before revision checking", async () => {
  await resetRateLimits();
  const a = await workspace();
  const requestId = crypto.randomUUID();
  const command = {
    type: "audience.confirm",
    plan: {
      id: "p",
      title: "Audience",
      description: "Prepared only",
      listName: "My audience",
      source: "MAPS",
      filters: { city: "São Paulo" },
      channel: "whatsapp",
      marketSize: null,
      dailyLimit: 50,
    },
  };
  const input = { requestId, expectedRevision: 0, command };
  const [one, two] = await Promise.all([
    executeWorkspaceCommand(a, input),
    executeWorkspaceCommand(a, input),
  ]);
  assert.deepEqual(one.result, two.result);
  assert.equal(two.snapshot.data.automations.length, 2);
  assert.ok(two.snapshot.data.automations.every((x) => x.status === "paused"));
  await assert.rejects(
    executeWorkspaceCommand(a, {
      ...input,
      command: { ...command, plan: { ...command.plan, title: "Changed" } },
    }),
    { status: 409 },
  );
  await assert.rejects(
    executeWorkspaceCommand(a, {
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      command: { type: "template.delete", id: "missing" },
    }),
    { status: 409 },
  );
  const before = await readWorkspaceSnapshot(a);
  await assert.rejects(
    executeWorkspaceCommand(a, {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      command: {
        type: "leads.import",
        list: { id: "rollback", name: "Rollback" },
        leads: [lead("invalid", "absent")],
      },
    }),
  );
  const after = await readWorkspaceSnapshot(a);
  assert.deepEqual(after, before);
  await assert.rejects(
    executeWorkspaceCommand(a, {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      command: {
        type: "leads.import",
        leads: Array.from({ length: 501 }, (_, i) =>
          lead(String(i), "rollback"),
        ),
      },
    }),
    { status: 422 },
  );
});
