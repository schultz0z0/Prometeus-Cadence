import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../src/demo/seed.ts";
import { decodeDemoState } from "../src/demo/storage.ts";
import { buildDemoCadenceOptions } from "../src/demo/cadence.ts";
import { filterAutomations } from "../src/domain/automation.ts";
test("version-one storage with malformed nested preferences is recoverable", () => {
  const s = createSeed();
  (s as unknown as { preferences: unknown }).preferences = {};
  assert.equal(decodeDemoState(JSON.stringify(s)).ok, false);
});
test("invalid stored qualification cannot poison dashboard counters", () => {
  const s = createSeed();
  (s.leads[0] as unknown as { qualification: string }).qualification =
    "unknown";
  assert.equal(decodeDemoState(JSON.stringify(s)).ok, false);
});
test("cadence rhythm matches the selected duration", () => {
  const s = createSeed();
  const base = {
    listId: s.lists[0].id,
    objective: "Primeiro contato",
    channels: ["EMAIL" as const],
    tone: "Pessoal",
    highlight: "",
    avoid: "",
    decisionMaker: "",
    profile: s.companyProfile,
  };
  for (const [rhythm, min, max] of [
    ["Curta", 1, 7],
    ["Padrão", 10, 14],
    ["Longa", 21, 21],
  ] as const) {
    const c = buildDemoCadenceOptions({ ...base, rhythm })[0];
    const days = c.steps.reduce((n, x) => n + x.delayDays, 0);
    assert.ok(days >= min && days <= max, `${rhythm}: ${days} days`);
  }
});
test("automation frequency and module filters apply together", () => {
  const s = createSeed();
  const a = s.automations[0];
  const result = filterAutomations(s.automations, {
    frequency: "daily",
    module: "Qualificação por IA",
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, a.id);
  assert.equal(
    filterAutomations(s.automations, { frequency: "weekly" }).length,
    0,
  );
});
