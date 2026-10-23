import test, { after } from "node:test";
import assert from "node:assert/strict";
import { getPools } from "../../src/server/db/pool.ts";
import { identityAction } from "../../src/server/workspaces/service.ts";
import {
  commandRequest,
  snapshotRequest,
} from "../../src/server/workspaces/http.ts";
import { verifiedUser, resetRateLimits, base } from "./helpers.ts";
import {workspaceTag} from '../../src/domain/workspace-tag.ts';
after(async () => getPools().close());
test("HTTP authorizes session, validates envelope, rejects old workspace preconditions and returns private DTO", async () => {
  await resetRateLimits();
  assert.equal(
    (await snapshotRequest(new Request(base + "/api/workspace/snapshot")))
      .status,
    401,
  );
  const user = await verifiedUser(),
    h = new Headers({
      cookie: user.cookie,
      origin: base,
      "content-type": "application/json",
    });
  const a = await identityAction(h, {
    type: "create",
    name: "HTTP A",
    requestId: crypto.randomUUID(),
  });
  const get = await snapshotRequest(
    new Request(base + "/api/workspace/snapshot", { headers: h }),
  );
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("cache-control"), "no-store");
  const first = await get.json();
  assert.equal(first.data.preferences.accountName, "Test User");
  assert.equal(first.data.leads.length, 0);
  h.set('if-none-match',workspaceTag(first.workspaceId,first.revision,first.capabilities));
  const unchanged=await snapshotRequest(new Request(base+'/api/workspace/snapshot',{headers:h}));
  assert.equal(unchanged.status,304);assert.equal(await unchanged.text(),'');
  h.set('if-none-match',workspaceTag('another-workspace',first.revision,first.capabilities));
  assert.equal((await snapshotRequest(new Request(base+'/api/workspace/snapshot',{headers:h}))).status,200);
  h.delete('if-none-match');
  const request = (body: unknown) =>
    new Request(base + "/api/workspace/commands", {
      method: "POST",
      headers: h,
      body: JSON.stringify(body),
    });
  assert.equal(
    (await commandRequest(request({ role: "owner", workspaceId: "foreign" })))
      .status,
    422,
  );
  await identityAction(h, {
    type: "create",
    name: "HTTP B",
    requestId: crypto.randomUUID(),
  });
  h.set("x-cadence-workspace", a.workspaceId!);
  assert.equal(
    (
      await commandRequest(
        request({
          requestId: crypto.randomUUID(),
          expectedRevision: 0,
          command: {
            type: "template.save",
            template: {
              id: "old-tab",
              name: "Old tab",
              body: "Hello",
              channel: "EMAIL",
              tags: [],
            },
          },
        }),
      )
    ).status,
    409,
  );
  const active = await (
    await snapshotRequest(
      new Request(base + "/api/workspace/snapshot", {
        headers: new Headers({ cookie: user.cookie }),
      }),
    )
  ).json();
  assert.equal(active.data.templates.length, 0);
  h.delete("x-cadence-workspace");
  h.set("origin", "https://foreign.example");
  assert.equal((await commandRequest(request({}))).status, 403);
});
