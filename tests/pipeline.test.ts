import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../src/demo/seed.ts";
import { eligibleCadenceLeads } from "../src/domain/cadence.ts";
test("pipeline and cadence share accepted qualifications and list eligibility", () => {
  const s = createSeed();
  const c = s.cadences[0];
  assert.equal(eligibleCadenceLeads(c, s.leads).length, 11);
  assert.ok(
    eligibleCadenceLeads(c, s.leads).every(
      (l) => l.qualification === "qualified",
    ),
  );
  const pending = {
    ...c,
    settings: { ...c.settings, acceptedQualifications: ["pending" as const] },
  };
  assert.equal(eligibleCadenceLeads(pending, s.leads).length, 7);
  assert.deepEqual(
    eligibleCadenceLeads({ ...c, listId: "empty" }, s.leads),
    [],
  );
});
