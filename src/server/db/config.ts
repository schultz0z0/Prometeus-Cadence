import "server-only";
export function databaseConfig() {
  const authUrl = process.env.AUTH_DATABASE_URL,
    appUrl = process.env.APP_DATABASE_URL;
  if (!authUrl || !appUrl)
    throw Error("Database configuration is missing. Run npm run env:init.");
  return { authUrl, appUrl };
}
