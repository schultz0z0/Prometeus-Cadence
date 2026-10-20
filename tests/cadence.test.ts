import test from "node:test";
import assert from "node:assert/strict";
import { validateCadence, renderMessage } from "../src/domain/cadence.ts";
import { buildDemoCadenceOptions } from "../src/demo/cadence.ts";
import { createSeed } from "../src/demo/seed.ts";
test("message preview preserves and identifies missing variables", () => {
  const l = createSeed().leads[0];
  l.city = undefined;
  const r = renderMessage("Oi {{nome}}, em {{cidade}}", l);
  assert.equal(r.text, "Oi Atlas Contabilidade, em {{cidade}}");
  assert.deepEqual(r.unresolved, ["cidade"]);
});
test("cadence rejects negative delays, invalid intervals and low bounce threshold", () => {
  const c = createSeed().cadences[0];
  c.steps[0].delayDays = -1;
  c.settings.intervalSeconds = [30, 10];
  c.settings.bounceLimit = 2;
  const issues = validateCadence(c);
  assert.ok(issues.some((x) => x.field === "steps.0.delayDays"));
  assert.ok(issues.some((x) => x.field === "intervalSeconds"));
  assert.ok(issues.some((x) => x.field === "bounceLimit"));
});
test("cadence suggestions are three drafts and honor channel and list", () => {
  const s = createSeed();
  const opts = buildDemoCadenceOptions({
    listId: "list-initial",
    objective: "Primeiro contato",
    channels: ["EMAIL"],
    tone: "Pessoal",
    rhythm: "Padrão",
    highlight: "",
    avoid: "",
    decisionMaker: "",
    profile: s.companyProfile,
  });
  assert.equal(opts.length, 3);
  assert.ok(
    opts.every(
      (c) =>
        c.status === "draft" &&
        c.listId === "list-initial" &&
        c.steps.every((x) => x.channel === "EMAIL"),
    ),
  );
});
