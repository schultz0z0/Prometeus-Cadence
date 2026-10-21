import fs from "node:fs";
import { randomBytes } from "node:crypto";
import {ensureWorkerEnvironment} from './provision-worker.mjs';
import {ensureChannelEnvironment} from './provision-channel-roles.mjs';
const path = ".env.local";
if (fs.existsSync(path)) {
  ensureWorkerEnvironment();
  ensureChannelEnvironment();
  console.log("Local environment already exists; preserved.");
  process.exit(0);
}
const secret = () => randomBytes(32).toString("hex");
const owner = secret(),
  auth = secret(),
  app = secret();
const url = (user, password, db) =>
  `postgresql://${user}:${password}@127.0.0.1:55432/${db}`;
const values = {
  POSTGRES_PASSWORD: owner,
  CADENCE_AUTH_PASSWORD: auth,
  CADENCE_APP_PASSWORD: app,
  MIGRATOR_DATABASE_URL: url("cadence_owner", owner, "prometeus_cadence"),
  AUTH_DATABASE_URL: url("cadence_auth", auth, "prometeus_cadence"),
  APP_DATABASE_URL: url("cadence_app", app, "prometeus_cadence"),
  TEST_MIGRATOR_DATABASE_URL: url(
    "cadence_owner",
    owner,
    "prometeus_cadence_test",
  ),
  TEST_AUTH_DATABASE_URL: url("cadence_auth", auth, "prometeus_cadence_test"),
  TEST_APP_DATABASE_URL: url("cadence_app", app, "prometeus_cadence_test"),
  BETTER_AUTH_SECRET: secret(),
  BETTER_AUTH_URL: "http://127.0.0.1:3210",
  APP_DATA_MODE: "server",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1125",
  MAILHOG_URL: "http://127.0.0.1:8125",
};
fs.writeFileSync(
  path,
  Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n",
  { flag: "wx" },
);
console.log("Local environment generated. Secret values were not printed.");
ensureWorkerEnvironment();
ensureChannelEnvironment();
