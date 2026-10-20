import "server-only";
import pg from "pg";
import { databaseConfig } from "./config.ts";
export function createPools(config: ReturnType<typeof databaseConfig>) {
  const shared = {
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  };
  const authPool = new pg.Pool({
    ...shared,
    connectionString: config.authUrl,
    options: "-c search_path=auth,public",
  });
  const appPool = new pg.Pool({
    ...shared,
    connectionString: config.appUrl,
    options: "-c search_path=app,public -c statement_timeout=15000",
  });
  // pg removes broken idle clients before emitting this event. Handle it here
  // so a database restart neither crashes the process nor logs a Client object.
  // Errors on checked-out queries still reject and roll back normally.
  authPool.on("error", () => {});
  appPool.on("error", () => {});
  return {
    authPool,
    appPool,
    close: async () => {
      await Promise.all([authPool.end(), appPool.end()]);
    },
  };
}
const globalPools = globalThis as typeof globalThis & {
  cadencePools?: ReturnType<typeof createPools>;
};
export function getPools() {
  return (globalPools.cadencePools ??= createPools(databaseConfig()));
}
