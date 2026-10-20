import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../src/demo/seed.ts";
import { createDemoRepository } from "../src/demo/repository.ts";
import { createManualAutomationOperation } from "../src/domain/automation.ts";
test("manual confirmation repeated before navigation creates one list and automation", () => {
  const s = createSeed();
  const repo = createDemoRepository(s);
  const operation = createManualAutomationOperation(repo);
  const input = { ...s.automations[0], name: "Manual QA" };
  const first = operation.confirm(input, { name: "Manual list" });
  const again = operation.confirm(input, { name: "Manual list" });
  assert.equal(first, again);
  assert.equal(repo.getSnapshot().lists.length, s.lists.length + 1);
  assert.equal(repo.getSnapshot().automations.length, s.automations.length + 1);
});
test("manual confirmation can retry after a storage error without orphaned entities", () => {
  const s = createSeed();
  let fail = true;
  const repo = createDemoRepository(s, () => {
    if (fail) throw Error("Storage unavailable");
  });
  const operation = createManualAutomationOperation(repo);
  assert.throws(() =>
    operation.confirm(s.automations[0], { name: "Retry list" }),
  );
  assert.equal(repo.getSnapshot().lists.length, s.lists.length);
  fail = false;
  operation.confirm(s.automations[0], { name: "Retry list" });
  assert.equal(repo.getSnapshot().lists.length, s.lists.length + 1);
});
