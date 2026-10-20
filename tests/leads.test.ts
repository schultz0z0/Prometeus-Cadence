import test from "node:test";
import assert from "node:assert/strict";
import { filterLeads } from "../src/domain/leads.ts";
import {
  parseContactImport,
  mapImportedContacts,
} from "../src/domain/import.ts";
import { createSeed } from "../src/demo/seed.ts";
test("filters by list status and case insensitive text with missing contacts", () => {
  const s = createSeed();
  const leads = filterLeads(s.leads, {
    search: "ATLAS",
    qualification: "qualified",
    listId: "list-initial",
  });
  assert.equal(leads.length, 1);
  assert.equal(leads[0].name, "Atlas Contabilidade");
  assert.equal(filterLeads(s.leads, { search: "zzz" }).length, 0);
});
test("CSV parser preserves quoted commas and maps fields", () => {
  const p = parseContactImport(
    'Empresa,Correio,Telefone\n"Atlas, Sul",contato@atlas.example,\nNorte,oi@norte.example,123',
  );
  assert.equal(p.errors.length, 0);
  assert.equal(p.rows[0][0], "Atlas, Sul");
  const mapped = mapImportedContacts(
    p,
    { name: 0, email: 1, phone: 2 },
    "list",
  );
  assert.equal(mapped.leads[0].name, "Atlas, Sul");
  assert.equal(mapped.leads[0].phone, undefined);
  assert.equal(mapped.leads[1].email, "oi@norte.example");
});
test("malformed CSV reports the physical line of an unclosed quote", () => {
  const p = parseContactImport('nome,email\n"Atlas,abc');
  assert.equal(p.errors[0].line, 2);
});
test("empty names are rejected before import and not silently saved", () => {
  const p = parseContactImport("nome,email\n,abc@example.com");
  const m = mapImportedContacts(p, { name: 0, email: 1 }, "list");
  assert.equal(m.leads.length, 0);
  assert.equal(m.errors.length, 1);
});
