import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { runMigrations } from "../../scripts/db-migrate.mjs";
import { createPools } from "../../src/server/db/pool.ts";
import { databaseConfig } from "../../src/server/db/config.ts";
test("idle disconnects are handled without throwing or exposing connection objects", async () => {
  const pools = createPools(databaseConfig());
  try {
    assert.doesNotThrow(() =>
      pools.authPool.emit("error", new Error("idle disconnect")),
    );
    assert.doesNotThrow(() =>
      pools.appPool.emit("error", new Error("idle disconnect")),
    );
  } finally {
    await pools.close();
  }
});

test("migrations are repeatable, checksum protected and transactional", async () => {
  const pool = new pg.Pool({
    connectionString: process.env.MIGRATOR_DATABASE_URL,
  });
  const dir = await mkdtemp(join(tmpdir(), "cadence-migrations-"));
  const table = "migration_probe_" + Date.now();
  try {
    await writeFile(
      join(dir, "001_probe.sql"),
      `CREATE TABLE ${table}(id integer PRIMARY KEY); INSERT INTO ${table} VALUES(1);`,
    );
    await runMigrations(pool, dir, "test_migrations_" + table);
    await runMigrations(pool, dir, "test_migrations_" + table);
    assert.equal((await pool.query(`SELECT * FROM ${table}`)).rowCount, 1);
    await writeFile(join(dir, "001_probe.sql"), "SELECT 1;");
    await assert.rejects(
      runMigrations(pool, dir, "test_migrations_" + table),
      /checksum/i,
    );
    await writeFile(
      join(dir, "001_probe.sql"),
      `CREATE TABLE ${table}(id integer PRIMARY KEY); INSERT INTO ${table} VALUES(1);`,
    );
    await writeFile(
      join(dir, "002_bad.sql"),
      `CREATE TABLE ${table}_rollback(id integer); SELECT definitely_missing_function();`,
    );
    await assert.rejects(runMigrations(pool, dir, "test_migrations_" + table));
    assert.equal(
      (
        await pool.query("SELECT to_regclass($1) AS name", [
          table + "_rollback",
        ])
      ).rows[0].name,
      null,
    );
  } finally {
    await pool.query(
      `DROP TABLE IF EXISTS ${table}, ${table}_rollback, test_migrations_${table}`,
    );
    await pool.end();
    await rm(dir, { recursive: true, force: true });
  }
});
