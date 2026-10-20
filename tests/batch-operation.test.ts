import test from "node:test";
import assert from "node:assert/strict";
import {
  createGenerationIdentity,
  prepareSimulatedGeneration,
} from "../src/demo/prospecting.ts";
import { createDemoRepository } from "../src/demo/repository.ts";
import { emptyWorkspace } from "../src/domain/empty-workspace.ts";
test("generation retry retains the same list, lead and job identities and one atomic commit", () => {
  const identity = createGenerationIdentity(),
    input = {
      source: "MAPS" as const,
      destination: identity.listId,
      filters: { term: "Test", location: "SP" },
      limit: 2,
    };
  const one = prepareSimulatedGeneration(input, "Prepared", identity),
    two = prepareSimulatedGeneration(input, "Prepared", identity);
  assert.deepEqual(one, two);
  let commits = 0;
  const repo = createDemoRepository(emptyWorkspace(), () => {
    commits++;
  });
  repo.saveLeadBatch(one.leads, {
    mode: "import",
    list: one.list,
    job: one.job,
  });
  assert.equal(commits, 1);
  repo.saveLeadBatch(two.leads, {
    mode: "import",
    list: two.list,
    job: two.job,
  });
  assert.equal(repo.getSnapshot().leads.length, 2);
  assert.equal(repo.getSnapshot().lists.length, 1);
  assert.equal(repo.getSnapshot().jobs.length, 1);
});
