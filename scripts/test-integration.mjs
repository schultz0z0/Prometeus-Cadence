import { spawnSync } from "node:child_process";
import fs from "node:fs";
process.loadEnvFile(".env.local");
for (const prefix of ["MIGRATOR", "AUTH", "APP", "WORKER"]) {
  const value = process.env[`TEST_${prefix}_DATABASE_URL`];
  if (!value || !new URL(value).pathname.endsWith("_test"))
    throw Error("Refusing integration tests against a non-test database.");
  process.env[`${prefix}_DATABASE_URL`] = value;
}
process.env.NODE_ENV = "test";
process.env.CADENCE_INTEGRATION = "1";
const known = [
  "migrations",
  "auth",
  "memberships",
  "tenancy",
  "commands",
  "client",
  "prospecting",
  "prospecting-results",
  "prospecting-worker",
];
const requested = process.argv.slice(2);
const suites = requested.length
  ? requested
  : known.filter((s) => fs.existsSync(`tests/integration/${s}.test.ts`));
if (!suites.length || suites.some((s) => !known.includes(s)))
  throw Error("Unknown integration suite.");
const args = [
  "--conditions=react-server",
  "--experimental-strip-types",
  "--test",
  "--test-concurrency=1",
  ...suites.map((s) => `tests/integration/${s}.test.ts`),
];
const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
  env: process.env,
});
process.exitCode = result.status ?? 1;
