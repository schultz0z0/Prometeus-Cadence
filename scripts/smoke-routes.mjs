import fs from "node:fs";
const base = process.env.SMOKE_URL || "http://127.0.0.1:3210";
const files = [
  "src/components/shell/navigation.ts",
  "src/modules/settings/navigation.ts",
];
const routes = new Set([
  "/",
  "/dashboard",
  "/contacts",
  "/leads/lead-1",
  "/leads/generator",
  "/leads/enrich",
  "/leads/qualifier",
  "/automations",
  "/automations/new",
  "/automations/new/ai",
  "/cadences",
  "/cadences/new",
  "/cadences/new/ai",
  "/cadences/cadence-initial",
  "/cadences/pipeline",
  "/templates",
  "/inbox",
  "/messages/whatsapp",
  "/reports",
  "/reports/funnel",
  "/reports/crm",
  "/executions",
  "/first-steps",
  "/sdr",
]);
for (const f of files)
  for (const m of fs
    .readFileSync(f, "utf8")
    .matchAll(/href:\s*["'](\/[^"']+)["']/g))
    routes.add(m[1]);
for (const m of fs
  .readFileSync(files[1], "utf8")
  .matchAll(/\["[^"]+",\s*"([^"]+)"\]/g))
  routes.add("/settings/" + m[1]);
const results = [];
for (const route of routes) {
  const r = await fetch(base + route);
  const html = await r.text();
  const ok =
    r.ok &&
    !html.includes("NEXT_HTTP_ERROR_FALLBACK;500") &&
    !html.includes("Internal Server Error");
  results.push({ route, status: r.status, ok });
}
const report = {
  date: new Date().toISOString(),
  base,
  note: "HTTP navigation smoke only; does not verify real connectors or authentication.",
  results,
};
fs.mkdirSync("docs/validation", { recursive: true });
fs.writeFileSync(
  "docs/validation/routes.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  `${results.filter((r) => r.ok).length}/${results.length} routes returned successfully.`,
);
const failures = results.filter((r) => !r.ok);
if (failures.length) {
  console.error(failures);
  process.exitCode = 1;
}
