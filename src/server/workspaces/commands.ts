import "server-only";
import { createHash } from "node:crypto";
import type { Principal } from "../../domain/workspace.ts";
import type { ConfirmationResult } from "../../domain/model.ts";
import { withWorkspaceTransaction } from "../db/transaction.ts";
import { readInTransaction, persistDiff } from "./repository.ts";
import { envelopeSchema } from "./schemas.ts";
import { createDemoRepository } from "../../demo/repository.ts";
import { requirePermission } from "../auth/permissions.ts";
import { AppError } from "../errors.ts";
import {syncAutomationDefinition} from '../automations/repository.ts';
function canonical(v: unknown): string {
  return JSON.stringify(
    v && typeof v === "object"
      ? Array.isArray(v)
        ? v.map((x) => JSON.parse(canonical(x)))
        : Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, JSON.parse(canonical(x))]),
          )
      : v,
  );
}
export async function readWorkspaceSnapshot(p: Principal) {
  return withWorkspaceTransaction(p, (c) => readInTransaction(c, p));
}
export async function executeWorkspaceCommand(
  principal: Principal,
  input: unknown,
) {
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError(
      422,
      "Campos inválidos. Revise os dados antes de salvar.",
    );
  const { requestId, expectedRevision, command } = parsed.data;
  return withWorkspaceTransaction(principal, async (c) => {
    const p = {
      ...principal,
      role: (await c.query("SELECT app.current_role() AS role")).rows[0].role,
    };
    await c.query(
      "INSERT INTO app.workspace_meta(workspace_id) VALUES($1) ON CONFLICT DO NOTHING",
      [p.workspaceId],
    );
    await c.query(
      "SELECT revision FROM app.workspace_meta WHERE workspace_id=$1 FOR UPDATE",
      [p.workspaceId],
    );
    const hash = createHash("sha256").update(canonical(command)).digest("hex");
    const previous = (
      await c.query(
        "SELECT * FROM app.command_result WHERE workspace_id=$1 AND request_id=$2",
        [p.workspaceId, requestId],
      )
    ).rows[0];
    if (previous) {
      if (previous.body_hash !== hash || previous.user_id !== p.userId)
        throw new AppError(409, "Este identificador já foi utilizado.");
      return {
        snapshot: await readInTransaction(c, p),
        result: previous.result as ConfirmationResult | undefined,
      };
    }
    const before = await readInTransaction(c, p);
    if (before.revision !== expectedRevision)
      throw new AppError(
        409,
        "Os dados mudaram em outra aba. Revise e salve novamente.",
      );
    requirePermission(p, "data.write");
    const repo = createDemoRepository(before.data);
    let result: ConfirmationResult | undefined;
    const existing = (rows: { id: string }[], id: string) => {
      if (!rows.some((r) => r.id === id))
        throw new AppError(404, "Registro não encontrado neste workspace.");
    };
    switch (command.type) {
      case "lead.upsert":
        repo.upsertLead(command.lead);
        break;
      case "leads.import":
        repo.importLeads(command.leads, command.list, {dedupScope:command.dedupScope??'workspace'});
        break;
      case "leads.batch":
        if (command.mode === "update")
          command.leads.forEach((l) => existing(before.data.leads, l.id));
        repo.saveLeadBatch(command.leads, {
          mode: command.mode,
          list: command.list,
          job: command.job,
        });
        break;
      case "leads.delete":
        command.ids.forEach((id) => existing(before.data.leads, id));
        repo.deleteLeads(command.ids);
        break;
      case "cadence.saveDraft":
        repo.saveCadenceDraft({...command.cadence,origin:before.data.cadences.find(c=>c.id===command.cadence.id)?.origin??{kind:'manual'}});
        break;
      case "context.saveDraft":
      case "context.approve": {
        if (command.type === "context.approve")
          requirePermission(p, "context.approve");
        if (
          command.profile.version !== before.data.companyProfile.version &&
          command.profile.version !== before.data.companyProfile.version + 1
        )
          throw new AppError(
            409,
            "O contexto foi alterado. Recarregue antes de salvar.",
          );
        repo.saveContext({
          ...command.profile,
          id: "profile",
          version: before.data.companyProfile.version + 1,
          approvedAt:
            command.type === "context.approve"
              ? new Date().toISOString()
              : null,
        });
        break;
      }
      case "template.save":
        repo.saveTemplate(command.template);
        break;
      case "template.delete":
        existing(before.data.templates, command.id);
        repo.deleteTemplate(command.id);
        break;
      case "automation.save":
        repo.saveAutomation(
          { ...command.automation, status: "paused",origin:before.data.automations.find(a=>a.id===command.automation.id)?.origin??{kind:'manual'} },
          command.list,
        );
        break;
      case "audience.confirm":
        result = repo.confirmAutomationPlan(command.plan, requestId);
        for(const automation of repo.getSnapshot().automations.filter(a=>result!.automationIds.includes(a.id)))repo.saveAutomation({...automation,origin:{kind:'manual'}});
        break;
      case "preferences.update": {
        const prefs = command.preferences;
        if (
          ["company", "timezone", "billingEmail"].some(
            (k) =>
              Object.hasOwn(prefs, k) &&
              prefs[k as keyof typeof prefs] !==
                before.data.preferences[k as keyof typeof prefs],
          )
        )
          requirePermission(p, "workspace.settings");
        const { accountName: _ignored, ...rest } = prefs;
        repo.updatePreferences(rest);
        break;
      }
      case "demoJob.record":
        repo.addJob(command.job);
        break;
    }
    try {
      await persistDiff(c, p, before.data, repo.getSnapshot());
      if(command.type==='automation.save')await syncAutomationDefinition(c,command.automation.id);
      if(command.type==='audience.confirm'&&result)for(const id of result.automationIds)await syncAutomationDefinition(c,id);
    } catch (e) {
      if (e && typeof e === "object" && "code" in e && e.code === "23503")
        throw new AppError(404, "Lista não encontrada neste workspace.");
      throw e;
    }
    await c.query(
      "UPDATE app.workspace_meta SET revision=revision+1 WHERE workspace_id=$1",
      [p.workspaceId],
    );
    await c.query("INSERT INTO app.command_result VALUES($1,$2,$3,$4,$5)", [
      p.workspaceId,
      requestId,
      p.userId,
      hash,
      result ? JSON.stringify(result) : null,
    ]);
    await c.query(
      "INSERT INTO app.audit(workspace_id,user_id,action) VALUES($1,$2,$3)",
      [p.workspaceId, p.userId, command.type],
    );
    return { snapshot: await readInTransaction(c, p), result };
  });
}
