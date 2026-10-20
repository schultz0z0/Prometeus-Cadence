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
  "/executions/qa-missing",
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
  const r = await fetch(base + route, {
    redirect: "manual",
    headers: process.env.SMOKE_COOKIE
      ? { cookie: process.env.SMOKE_COOKIE }
      : {},
    signal: AbortSignal.timeout(60000),
  });
  const html = await r.text();
  const protectedRedirect =
    !process.env.SMOKE_COOKIE &&
    route !== "/" &&
    r.status === 307 &&
    r.headers.get("location") === "/login";
  const rootRedirect =
    route === "/" &&
    r.status === 307 &&
    r.headers.get("location") === "/dashboard";
  const ok =
    (r.ok || protectedRedirect || rootRedirect) &&
    !html.includes("NEXT_HTTP_ERROR_FALLBACK;500") &&
    !html.includes("Internal Server Error");
  results.push({ route, status: r.status, protectedRedirect, ok });
}
for (const route of [
  "/api/workspace/snapshot",
  "/api/identity",
  "/api/security",
  "/api/prospecting/capabilities",
  "/api/prospecting/jobs",
]) {
  const response = await fetch(base + route, {
    headers: process.env.SMOKE_COOKIE
      ? { cookie: process.env.SMOKE_COOKIE,...(process.env.SMOKE_WORKSPACE_ID?{'x-cadence-workspace':process.env.SMOKE_WORKSPACE_ID}:{}) }
      : {},
    signal: AbortSignal.timeout(60000),
  });
  results.push({
    route,
    status: response.status,
    ok: response.status === (process.env.SMOKE_COOKIE ? 200 : 401),
  });
}
const report = {
  date: new Date().toISOString(),
  base,
  note: "Authenticated identity milestone. Anonymous app routes must redirect to login; private APIs must return 401. No real external connector is tested.",
  results,
};
fs.mkdirSync("docs/validation", { recursive: true });
fs.writeFileSync(
  "docs/validation/routes-03.json",
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
