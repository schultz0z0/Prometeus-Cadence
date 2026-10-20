import fs from "node:fs";
import pg from "pg";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "../src/server/auth/auth.ts";
process.loadEnvFile(".env.local");
const pool = new pg.Pool({
  connectionString: process.env.MIGRATOR_DATABASE_URL,
  options: "-c search_path=auth,public",
});
try {
  const plan = await getMigrations(authOptions(pool));
  const sql = await plan.compileMigrations();
  if (!sql.trim()) throw Error("No auth schema changes to generate.");
  const text =
    "-- Generated from Better Auth 1.7.12 with organization and database rate limiting.\nSET LOCAL search_path TO auth,public;\n" +
    sql +
    "\nGRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA auth TO cadence_auth;\nGRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA auth TO cadence_auth;\n";
  fs.writeFileSync("db/migrations/002-auth.sql", text, { flag: "wx" });
  console.log("Auth SQL generated for review; no migration executed.");
} finally {
  await pool.end();
}
