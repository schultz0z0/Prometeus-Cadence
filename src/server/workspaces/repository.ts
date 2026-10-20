import "server-only";
import type { PoolClient } from "pg";
import type { Principal, WorkspaceSnapshot } from "../../domain/workspace.ts";
import type { DemoState } from "../../domain/model.ts";
import { emptyWorkspace } from "../../domain/empty-workspace.ts";
import { capabilities } from "../auth/permissions.ts";
export async function readInTransaction(
  c: PoolClient,
  p: Principal,
): Promise<WorkspaceSnapshot> {
  const data = emptyWorkspace();
  await c.query(
    "INSERT INTO app.workspace_meta(workspace_id) VALUES($1) ON CONFLICT DO NOTHING",
    [p.workspaceId],
  );
  await c.query(
    "SELECT revision FROM app.workspace_meta WHERE workspace_id=$1 FOR SHARE",
    [p.workspaceId],
  );
  data.lists = (await c.query("SELECT id,name FROM app.list ORDER BY id")).rows;
  for (const [key, table] of [
    ["leads", "lead"],
    ["automations", "automation"],
    ["cadences", "cadence"],
    ["templates", "template"],
    ["jobs", "job"],
  ] as const) {
    data[key] = (
      await c.query(`SELECT payload FROM app.${table} ORDER BY id`)
    ).rows.map((r) => r.payload) as never;
  }
  const context = (
    await c.query(
      "SELECT payload FROM app.context_version ORDER BY version DESC LIMIT 1",
    )
  ).rows[0];
  if (context) data.companyProfile = context.payload;
  const wp = (await c.query("SELECT payload FROM app.workspace_preferences"))
    .rows[0];
  const up = (
    await c.query("SELECT payload FROM app.user_preferences WHERE user_id=$1", [
      p.userId,
    ])
  ).rows[0];
  data.preferences = { ...data.preferences, ...wp?.payload, ...up?.payload };
  const revision = Number(
    (
      await c.query(
        "SELECT revision FROM app.workspace_meta WHERE workspace_id=$1",
        [p.workspaceId],
      )
    ).rows[0].revision,
  );
  const role = (await c.query("SELECT app.current_role() AS role")).rows[0]
    .role;
  return {
    workspaceId: p.workspaceId,
    revision,
    data,
    capabilities: capabilities(role),
  };
}
export async function persistDiff(
  c: PoolClient,
  p: Principal,
  before: DemoState,
  next: DemoState,
) {
  const ws = p.workspaceId;
  for (const list of next.lists) {
    if (!before.lists.some((l) => l.id === list.id && l.name === list.name))
      await c.query(
        "INSERT INTO app.list(workspace_id,id,name) VALUES($1,$2,$3) ON CONFLICT(workspace_id,id) DO UPDATE SET name=EXCLUDED.name",
        [ws, list.id, list.name],
      );
  }
  for (const [key, table, hasList] of [
    ["leads", "lead", true],
    ["automations", "automation", true],
    ["cadences", "cadence", true],
    ["templates", "template", false],
    ["jobs", "job", false],
  ] as const) {
    const old = before[key] as { id: string }[],
      rows = next[key] as { id: string; listId?: string }[];
    for (const row of old)
      if (!rows.some((r) => r.id === row.id))
        await c.query(
          `DELETE FROM app.${table} WHERE workspace_id=$1 AND id=$2`,
          [ws, row.id],
        );
    for (const row of rows) {
      if (
        JSON.stringify(old.find((r) => r.id === row.id)) === JSON.stringify(row)
      )
        continue;
      if (hasList)
        await c.query(
          `INSERT INTO app.${table}(workspace_id,id,list_id,payload) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,id) DO UPDATE SET list_id=EXCLUDED.list_id,payload=EXCLUDED.payload`,
          [ws, row.id, row.listId, JSON.stringify(row)],
        );
      else
        await c.query(
          `INSERT INTO app.${table}(workspace_id,id,payload) VALUES($1,$2,$3) ON CONFLICT(workspace_id,id) DO UPDATE SET payload=EXCLUDED.payload`,
          [ws, row.id, JSON.stringify(row)],
        );
    }
  }
  if (
    JSON.stringify(before.companyProfile) !==
    JSON.stringify(next.companyProfile)
  )
    await c.query("INSERT INTO app.context_version VALUES($1,$2,$3)", [
      ws,
      next.companyProfile.version,
      JSON.stringify(next.companyProfile),
    ]);
  const {
    company,
    timezone,
    billingEmail,
    accountName: _ignored,
    ...personal
  } = next.preferences;
  if (JSON.stringify(before.preferences) !== JSON.stringify(next.preferences)) {
    await c.query(
      "INSERT INTO app.workspace_preferences VALUES($1,$2) ON CONFLICT(workspace_id) DO UPDATE SET payload=EXCLUDED.payload",
      [ws, JSON.stringify({ company, timezone, billingEmail })],
    );
    await c.query(
      "INSERT INTO app.user_preferences VALUES($1,$2,$3) ON CONFLICT(workspace_id,user_id) DO UPDATE SET payload=EXCLUDED.payload",
      [ws, p.userId, JSON.stringify(personal)],
    );
  }
}
