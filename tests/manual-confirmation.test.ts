import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../src/demo/seed.ts";
import { createDemoRepository } from "../src/demo/repository.ts";
import { createManualAutomationOperation } from "../src/domain/automation.ts";
test("manual confirmation repeated before navigation creates one list and automation", async () => {
  const s = createSeed();
  const repo = createDemoRepository(s);
  const operation = createManualAutomationOperation(repo);
  const input = { ...s.automations[0], name: "Manual QA" };
  const first = operation.confirm(input, { name: "Manual list" });
  const again = operation.confirm(input, { name: "Manual list" });
  assert.equal(first, again);
  assert.equal(await first, await again);
  assert.equal(repo.getSnapshot().lists.length, s.lists.length + 1);
  assert.equal(repo.getSnapshot().automations.length, s.automations.length + 1);
});
test("manual confirmation can retry after a storage error without orphaned entities", async () => {
  const s = createSeed();
  let fail = true;
  const repo = createDemoRepository(s, () => {
    if (fail) throw Error("Storage unavailable");
  });
  const operation = createManualAutomationOperation(repo);
  await assert.rejects(async () =>
    operation.confirm(s.automations[0], { name: "Retry list" }),
  );
  assert.equal(repo.getSnapshot().lists.length, s.lists.length);
  fail = false;
  await operation.confirm(s.automations[0], { name: "Retry list" });
  assert.equal(repo.getSnapshot().lists.length, s.lists.length + 1);
});
test("asynchronous manual confirmation shares one in-flight promise and remains retryable", async () => {
  const s = createSeed();
  let calls = 0;
  let release!: () => void;
  const repo = {
    saveAutomation: () => {
      calls++;
      return new Promise<void>((r) => {
        release = r;
      });
    },
  };
  const op = createManualAutomationOperation(repo);
  const a = op.confirm(s.automations[0], { name: "Async" }),
    b = op.confirm(s.automations[0], { name: "Async" });
  assert.ok(a instanceof Promise);
  assert.equal(a, b);
  assert.equal(calls, 1);
  release();
  assert.equal(await a, await b);
  assert.equal(calls, 1);
});
