import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {ensureWorkerEnvironment,provisionWorker} from './provision-worker.mjs';

export async function runMigrations(
  pool,
  directory,
  table = "schema_migrations",
) {
  if (!/^[a-z_][a-z0-9_]*$/.test(table))
    throw Error("Invalid migration ledger identifier.");
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [
      "cadence:" + table,
    ]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS public.${table}(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const files = (await fs.readdir(directory))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const name of files) {
      const sql = await fs.readFile(path.join(directory, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const old = (
        await client.query(
          `SELECT checksum FROM public.${table} WHERE name=$1`,
          [name],
        )
      ).rows[0];
      if (old) {
        if (old.checksum !== checksum)
          throw Error(`Migration checksum mismatch: ${name}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO public.${table}(name,checksum) VALUES($1,$2)`,
          [name, checksum],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [
      "cadence:" + table,
    ]);
    client.release();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.loadEnvFile(".env.local");
  ensureWorkerEnvironment();
  const useTest = process.argv.includes("--test");
  const connectionString =
    process.env[
      useTest ? "TEST_MIGRATOR_DATABASE_URL" : "MIGRATOR_DATABASE_URL"
    ];
  if (!connectionString)
    throw Error("Missing migrator database configuration.");
  if (useTest && !new URL(connectionString).pathname.endsWith("_test"))
    throw Error("Refusing non-test database.");
  const pool = new pg.Pool({ connectionString });
  try {
    await provisionWorker(pool);
    await runMigrations(pool, "db/migrations");
    console.log(`Migrations applied (${useTest ? "test" : "local"} database).`);
  } finally {
    await pool.end();
  }
}
