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
