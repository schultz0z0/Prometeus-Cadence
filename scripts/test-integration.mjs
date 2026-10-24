import { spawnSync } from "node:child_process";
import fs from "node:fs";
import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {runMigrations} from './db-migrate.mjs';
process.loadEnvFile(".env.local");
for (const prefix of ["MIGRATOR", "AUTH", "APP", "WORKER", "INGRESS", "DISPATCH"]) {
  const value = process.env[`TEST_${prefix}_DATABASE_URL`];
  if (!value || !new URL(value).pathname.endsWith("_test"))
    throw Error("Refusing integration tests against a non-test database.");
  process.env[`${prefix}_DATABASE_URL`] = value;
}
process.env.NODE_ENV = "test";
process.env.CADENCE_INTEGRATION = "1";
const known = [
  "openwa-storage",
  "openwa-connections",
  "openwa-ingress",
  "openwa-limits",
  "openwa-dispatch",
  "openwa-publication",
  "openwa-recovery",
  "twilio-retirement",
  "chatgpt-oauth",
  "mail-storage",
  "mail-oauth",
  "mail-connections",
  "mail-sync",
  "multichannel-publication",
  "mail-dispatch",
  "mail-inbound",
  "mail-http",
  "mail-inbox",
  "mail-maintenance",
  "whatsapp-review-regressions",
  "whatsapp-lifecycle",
  "whatsapp-storage",
  "whatsapp-connections",
  "whatsapp-ingress",
  "cadence-publication",
  "whatsapp-http",
  "whatsapp-dispatch",
  "whatsapp-recovery",
  "whatsapp-reconciliation",
  "migrations",
  "auth",
  "memberships",
  "tenancy",
  "commands",
  "client",
  "prospecting",
  "prospecting-results",
  "prospecting-worker",
  "prospecting-pipeline",
  "ai-settings",
  "ai-routing-pipeline",
  "ai-probe",
  "planning-storage",
  "context-products",
  "planning-pipeline",
  "planning-confirmation",
  "automation-authorization",
  "automation-scheduler",
  "automation-lifecycle",
  "received-step",
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
// Preserve the developer's durable _test database. Every run gets a fresh,
// isolated catalog so reservations from old fixtures cannot exhaust global
// budgets or starve finite workers. Production limits are never changed.
const database='prometeus_it_'+randomBytes(8).toString('hex')+'_test';
if(!/^prometeus_it_[a-f0-9]{16}_test$/.test(database))throw Error('Invalid isolated test database');
const admin=new pg.Pool({connectionString:process.env.MIGRATOR_DATABASE_URL});
let created=false;
try{
 await admin.query('CREATE DATABASE "'+database+'"');created=true;
 for(const prefix of ['MIGRATOR','AUTH','APP','WORKER','INGRESS','DISPATCH']){
  const u=new URL(process.env[`${prefix}_DATABASE_URL`]);u.pathname='/'+database;process.env[`${prefix}_DATABASE_URL`]=u.toString();
 }
 const migrator=new pg.Pool({connectionString:process.env.MIGRATOR_DATABASE_URL});
 try{
  await migrator.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA auth AUTHORIZATION cadence_owner;CREATE SCHEMA app AUTHORIZATION cadence_owner;
GRANT USAGE ON SCHEMA auth TO cadence_auth;GRANT USAGE ON SCHEMA app TO cadence_app,cadence_worker,cadence_ingress,cadence_dispatcher;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO cadence_auth;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT USAGE,SELECT ON SEQUENCES TO cadence_auth;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO cadence_app;`);
  await runMigrations(migrator,'db/migrations');
 }finally{await migrator.end();}
 const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});process.exitCode=result.status??1;
}finally{
 if(created)await admin.query('DROP DATABASE "'+database+'" WITH (FORCE)');
 await admin.end();
}
