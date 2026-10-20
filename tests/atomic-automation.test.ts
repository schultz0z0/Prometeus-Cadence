import test from "node:test";
import assert from "node:assert/strict";
import { createDemoRepository } from "../src/demo/repository.ts";
import { createSeed } from "../src/demo/seed.ts";

test("manual automation and its new list persist in a single commit", () => {
  const s = createSeed();
  let commits = 0;
  const repo = createDemoRepository(s, () => {
    commits++;
  });
  repo.saveAutomation(
    { ...s.automations[0], id: "manual", listId: "new-list" },
    { id: "new-list", name: "New list" },
  );
  assert.equal(commits, 1);
  assert.equal(repo.getSnapshot().lists.at(-1)?.id, "new-list");
});

test("manual creation storage failure cannot leave an orphaned list", () => {
  const s = createSeed();
  const repo = createDemoRepository(s, () => {
    throw Error("Full");
  });
  assert.throws(() =>
    repo.saveAutomation(
      { ...s.automations[0], id: "manual", listId: "new-list" },
      { id: "new-list", name: "New list" },
    ),
  );
  assert.deepEqual(repo.getSnapshot(), s);
});
