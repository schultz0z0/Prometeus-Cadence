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
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
after(async () => getPools().close());
test("one bulk action and its job roll back together and retry once after a committed response is lost", async () => {
  await resetRateLimits();
  const p = await workspace();
  const job = {
    id: "job-batch",
    name: "Batch",
    type: "generation",
    status: "completed",
    count: 1,
    demo: true,
    billableUsage: 0,
    createdAt: new Date().toISOString(),
    details: "Local simulation",
  };
  const body = {
    requestId: crypto.randomUUID(),
    expectedRevision: 0,
    command: {
      type: "leads.batch",
      mode: "import",
      list: { id: "batch-list", name: "Batch" },
      leads: [lead("batch-lead", "batch-list")],
      job,
    },
  };
  await executeWorkspaceCommand(p, body);
  const retry = await executeWorkspaceCommand(p, body);
  assert.equal(retry.snapshot.revision, 1);
  assert.equal(retry.snapshot.data.jobs.length, 1);
  assert.equal(retry.snapshot.data.leads.length, 1);
  const invalid = {
    requestId: crypto.randomUUID(),
    expectedRevision: 1,
    command: {
      ...body.command,
      mode: "update",
      leads: [{ ...lead("batch-lead", "absent") }],
      job: { ...job, id: "rollback-job" },
    },
  };
  await assert.rejects(executeWorkspaceCommand(p, invalid));
  const s = await readWorkspaceSnapshot(p);
  assert.equal(s.revision, 1);
  assert.equal(s.data.jobs.length, 1);
  assert.equal(s.data.leads[0].listId, "batch-list");
});
async function workspace() {
  const u = await verifiedUser();
  const h = new Headers({ cookie: u.cookie });
  await identityAction(h, {
    type: "create",
    requestId: crypto.randomUUID(),
    name: "Commands test",
  });
  const p=await requirePrincipal(h);
  await withWorkspaceTransaction(p,c=>c.query('SELECT app.billing_start_trial($1)',[crypto.randomUUID()]));
  return p;
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
