import test from "node:test";
import assert from "node:assert/strict";
import { createDraftRecovery } from "../src/client/draft-recovery.ts";

test("draft recovery keeps only the latest edited value under a static label", () => {
  const recovery = createDraftRecovery();
  const field = {
    tagName: "TEXTAREA", type: "textarea", name: "", id: "", value: "",
    getAttribute: () => null,
    labels: [{ children: [
      { tagName: "SPAN", textContent: "Corpo *" },
      { tagName: "TEXTAREA", textContent: "Original server text" },
    ] }],
  };
  for (const value of ["R", "Ra", "Rascunho final"]) {
    field.value = value;
    recovery.capture(field);
  }
  recovery.capture({ ...field, tagName: "INPUT", type: "password", value: "secret" });
  assert.equal(recovery.text(), "Corpo *: Rascunho final");
  assert.equal(recovery.size(), 1);
});
