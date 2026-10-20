import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkspaceRepository,
  runAction,
} from "../src/client/workspace-repository.ts";
import { emptyWorkspace } from "../src/domain/empty-workspace.ts";
import { createContactOperation } from "../src/domain/contact-operation.ts";
const initial = () => ({
  workspaceId: "a",
  revision: 0,
  data: emptyWorkspace(),
  capabilities: ["data.write"],
});
test("an external refresh never gives an old form permission to overwrite newer data", async () => {
  let writes = 0;
  const repo = createWorkspaceRepository(initial(), async (_url, init) => {
    if (init?.method === "POST") {
      writes++;
      return Response.json({ snapshot: { ...initial(), revision: 3 } });
    }
    return Response.json({ ...initial(), revision: 2 });
  });
  await repo.refresh();
  const old = {
    id: "t",
    name: "Old draft",
    body: "Old body",
    channel: "EMAIL" as const,
    tags: [],
  };
  await assert.rejects(repo.saveTemplate(old));
  await assert.rejects(repo.saveTemplate(old));
  assert.equal(writes, 0);
  assert.equal(repo.access().kind, "conflict");
});
test("failed queue entry cancels dependent entries before they can write", async () => {
  let calls = 0;
  const repo = createWorkspaceRepository(initial(), async () => {
    calls++;
    throw Error("offline");
  });
  const a = repo.saveTemplate({
      id: "a",
      name: "A",
      body: "A",
      channel: "EMAIL",
      tags: [],
    }),
    b = repo.deleteTemplate("b");
  await Promise.allSettled([a, b]);
  assert.equal(calls, 1);
});
test("workspace mismatch or removal clears cached rows and blocks the old surface", async () => {
  for (const status of [403, 409]) {
    const start = initial();
    start.data.templates.push({
      id: "private",
      name: "Private",
      body: "Secret draft",
      channel: "EMAIL",
      tags: [],
    });
    const repo = createWorkspaceRepository(start, async () =>
      Response.json(
        {
          message: "Workspace changed",
          code: status === 409 ? "WORKSPACE_CHANGED" : undefined,
        },
        { status },
      ),
    );
    await assert.rejects(repo.refresh());
    assert.equal(repo.getSnapshot().templates.length, 0);
    assert.equal(repo.snapshot().capabilities.length, 0);
    assert.equal(repo.access().kind, "blocked");
    await assert.rejects(repo.deleteTemplate("private"));
  }
});
test("first-contact retry keeps its prepared list after an uncertain commit", async () => {
  let calls = 0;
  const lists: { id: string; name: string }[] = [];
  const seen: string[] = [];
  const operation = createContactOperation(
    {
      importLeads: async (leads, list) => {
        calls++;
        seen.push(leads[0].listId);
        if (calls === 1) {
          lists.push(list!);
          throw Error("response lost");
        }
      },
      upsertLead: async () => {
        throw Error("must retain import operation");
      },
    },
    lists,
  );
  await assert.rejects(
    operation.save(
      { ...operation.initialLead, name: "First contact" },
      "First list",
    ),
  );
  await operation.save(
    { ...operation.initialLead, name: "First contact" },
    "First list",
  );
  assert.equal(calls, 2);
  assert.equal(seen[0], seen[1]);
  assert.ok(seen[1]);
});
test("rejected async mutation does not toast success or navigate", async () => {
  const notices: string[] = [];
  const ok = await runAction(
    async () => {
      throw Error("offline");
    },
    (m) => notices.push(m),
    "Saved",
  );
  assert.equal(ok, false);
  assert.ok(!notices.includes("Saved"));
});
test("retry after network failure reuses request id; snapshot publishes only after success", async () => {
  const requests: any[] = [];
  let fail = true;
  const repo = createWorkspaceRepository(initial(), async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    if (fail) throw Error("offline");
    return Response.json({
      snapshot: {
        ...initial(),
        revision: 1,
        data: { ...emptyWorkspace(), templates: [body.command.template] },
      },
    });
  });
  const t = {
    id: "t",
    name: "Draft",
    body: "Hello",
    channel: "EMAIL" as const,
    tags: [],
  };
  await assert.rejects(repo.saveTemplate(t));
  assert.equal(repo.getSnapshot().templates.length, 0);
  fail = false;
  await repo.saveTemplate(t);
  assert.equal(requests[0].requestId, requests[1].requestId);
  assert.equal(repo.getSnapshot().templates.length, 1);
});
test("an uncertain retry keeps its original revision after another tab commits", async () => {
  const requests: any[] = [];
  let fail = true;
  const repo = createWorkspaceRepository(initial(), async (_url, init) => {
    if (init?.method !== "POST")
      return Response.json({ ...initial(), revision: 7 });
    const body = JSON.parse(String(init.body));
    requests.push(body);
    if (fail) throw Error("response lost");
    return Response.json({ message: "Old revision" }, { status: 409 });
  });
  const template = {
    id: "t",
    name: "Old",
    body: "Old",
    channel: "EMAIL" as const,
    tags: [],
  };
  await assert.rejects(repo.saveTemplate(template));
  await repo.refresh();
  fail = false;
  await assert.rejects(repo.saveTemplate(template));
  assert.equal(requests[0].expectedRevision, requests[1].expectedRevision);
  assert.equal(requests[1].expectedRevision, 0);
});
test("conflict refreshes base without blind retry; disposed workspace ignores late responses", async () => {
  let writes = 0;
  const repo = createWorkspaceRepository(initial(), async (_url, init) => {
    if (init?.method === "POST") {
      writes++;
      return Response.json({ message: "Conflict" }, { status: 409 });
    }
    return Response.json({ ...initial(), revision: 4 });
  });
  await assert.rejects(repo.deleteTemplate("t"));
  assert.equal(writes, 1);
  assert.equal(repo.snapshot().revision, 4);
  let release!: (r: Response) => void;
  const other = createWorkspaceRepository(
    initial(),
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  const pending = other.saveTemplate({
    id: "t",
    name: "Draft",
    body: "Text",
    channel: "EMAIL",
    tags: [],
  });
  await new Promise((r) => setImmediate(r));
  other.dispose();
  release(Response.json({ snapshot: { ...initial(), revision: 5 } }));
  await assert.rejects(pending);
  assert.equal(other.snapshot().revision, 0);
});
test("a delayed refresh cannot replace a newer committed snapshot", async () => {
  let release!: (r: Response) => void;
  const repo = createWorkspaceRepository(initial(), async (_url, init) => {
    if (init?.method === "POST")
      return Response.json({ snapshot: { ...initial(), revision: 2 } });
    return new Promise((r) => {
      release = r;
    });
  });
  const refresh = repo.refresh();
  await repo.saveTemplate({
    id: "t",
    name: "Draft",
    body: "Text",
    channel: "EMAIL",
    tags: [],
  });
  release(Response.json({ ...initial(), revision: 1 }));
  await refresh;
  assert.equal(repo.snapshot().revision, 2);
});
