import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../src/demo/seed.ts";
import { createDemoRepository } from "../src/demo/repository.ts";
import { suggestDemoAudiences } from "../src/demo/audience.ts";
import {
  renderMessage,
  renderStepPreview,
  moveCadenceStep,
} from "../src/domain/cadence.ts";

test("subject-only variables are included in the message preview warning", () => {
  const s = createSeed();
  const step = {
    ...s.cadences[0].steps[0],
    channel: "EMAIL" as const,
    subject: "Olá {{decisor_ausente}}",
    body: "Olá {{nome}}",
  };
  const result = renderStepPreview(step, s.leads[0]);
  assert.deepEqual(result.unresolved, ["decisor_ausente"]);
  assert.equal(result.subject, "Olá {{decisor_ausente}}");
  assert.ok(result.text.includes(s.leads[0].name));
});

test("moving an edited step keeps unsaved text and leaves the original unchanged", () => {
  const s = createSeed();
  const c = s.cadences[0];
  const edited = {
    ...c.steps[1],
    body: "Revisão humana ainda não salva",
    subject: "Novo assunto",
  };
  const moved = moveCadenceStep(c, edited, -1);
  assert.equal(moved.steps[0].id, edited.id);
  assert.equal(moved.steps[0].body, edited.body);
  assert.equal(moved.steps[0].subject, edited.subject);
  assert.notEqual(c.steps[1].body, edited.body);
});

test("email audience keeps reviewed filters and only requests email extraction", () => {
  const s = createSeed();
  const repo = createDemoRepository(s);
  const p = {
    ...suggestDemoAudiences({
      description: "Público inicial",
      channel: "email",
      profile: s.companyProfile,
    })[0],
    title: "Nome da automação",
    filters: { term: "Clínicas revisadas", location: "Curitiba" },
  };
  const result = repo.confirmAutomationPlan(p, "email-confirm");
  const autos = repo
    .getSnapshot()
    .automations.filter((a) => result.automationIds.includes(a.id));
  assert.equal(autos.length, 2);
  for (const a of autos) {
    assert.equal(a.filters.term, "Clínicas revisadas");
    assert.equal(a.filters.location, "Curitiba");
    assert.equal(a.filters.channel, "email");
  }
  const qualify = autos.find((a) => a.source === "QUALIFY")!;
  assert.ok(qualify.modules.includes("Extrair e-mails"));
  assert.ok(!qualify.modules.includes("Extrair telefones"));
});

test("unknown variables cannot resolve through inherited object properties", () => {
  const s = createSeed();
  const result = renderMessage("{{toString}} / {{constructor}}", s.leads[0]);
  assert.equal(result.text, "{{toString}} / {{constructor}}");
  assert.deepEqual(result.unresolved, ["toString", "constructor"]);
});
