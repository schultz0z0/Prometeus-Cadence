import type { DemoRepository } from "../domain/repository.ts";
import type { WorkspaceSnapshot } from "../domain/workspace.ts";
import type { WorkspaceCommand } from "../domain/commands.ts";
import type { ConfirmationResult } from "../domain/model.ts";
import { decodeDemoState } from "../demo/storage.ts";
import { emptyWorkspace } from "../domain/empty-workspace.ts";
import {workspaceTag} from '../domain/workspace-tag.ts';
export interface WorkspaceAccess {
  kind: "ready" | "conflict" | "blocked";
  message: string;
}
export type AsyncRepository = {
  [K in keyof DemoRepository]: DemoRepository[K] extends (
    ...args: infer A
  ) => infer R
    ? K extends "subscribe" | "getSnapshot"
      ? DemoRepository[K]
      : (...args: A) => Promise<Awaited<R>>
    : never;
};
export async function runAction(
  fn: () => unknown | Promise<unknown>,
  notify: (message: string) => void,
  success?: string,
) {
  try {
    await fn();
    if (success) notify(success);
    return true;
  } catch (e) {
    notify(
      e instanceof Error
        ? e.message
        : "Não foi possível salvar. Tente novamente.",
    );
    return false;
  }
}
function validate(value: unknown, workspaceId: string): WorkspaceSnapshot {
  const v = value as WorkspaceSnapshot;
  if (
    !v ||
    v.workspaceId !== workspaceId ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 0 ||
    !Array.isArray(v.capabilities) ||
    !v.capabilities.every((p) => typeof p === "string") ||
    !decodeDemoState(JSON.stringify(v.data)).ok
  )
    throw Error("Resposta de workspace inválida. Recarregue a página.");
  return v;
}
export function createWorkspaceRepository(
  initial: WorkspaceSnapshot,
  transport: typeof fetch = fetch,
  options:{hasEdits?:()=>boolean;onLocalCommit?:()=>void}={},
) {
  let snapshot = validate(initial, initial.workspaceId),
    disposed = false,
    generation = 0,
    queue = Promise.resolve();
  let access: WorkspaceAccess = { kind: "ready", message: "" };
  const listeners = new Set<() => void>(),
    pending = new Map<
      string,
      { requestId: string; expectedRevision?: number }
    >();
  const emit = () => listeners.forEach((f) => f());
  const controller=new AbortController();let refreshing:Promise<void>|null=null;
  function invalidate(message: string) {
    controller.abort();
    generation++;
    access = { kind: "blocked", message };
    snapshot = {
      workspaceId: snapshot.workspaceId,
      revision: snapshot.revision,
      data: emptyWorkspace(),
      capabilities: [],
    };
    pending.clear();
    emit();
  }
  function publish(next: WorkspaceSnapshot, external = false) {
    if (disposed) throw Error("O workspace foi alterado.");
    if (access.kind === "blocked") throw Error(access.message);
    if (next.revision < snapshot.revision) return;
    if (external && next.revision > snapshot.revision && (pending.size>0||(options.hasEdits?.()??true))){
      access = {
        kind: "conflict",
        message:
          "Há alterações de outra aba. Preserve seu texto e recarregue os dados antes de revisar e salvar.",
      };
      if(JSON.stringify(next.capabilities)!==JSON.stringify(snapshot.capabilities))snapshot={...snapshot,capabilities:next.capabilities};
      emit();return;
    }
    snapshot = next;
    emit();
  }
  function refresh():Promise<void> {
    if(disposed)return Promise.resolve();
    if(access.kind==='blocked')return Promise.reject(Error(access.message));
    if(refreshing)return refreshing;
    refreshing=readFresh();const active=refreshing;const clear=()=>{if(refreshing===active)refreshing=null;};void active.then(clear,clear);return active;
  }
  async function readFresh() {
    const r = await transport("/api/workspace/snapshot", {
      cache: "no-store",
      signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),
      headers: { "x-cadence-workspace": snapshot.workspaceId,"if-none-match":workspaceTag(snapshot.workspaceId,snapshot.revision,snapshot.capabilities) },
    });
    if(r.status===304||disposed)return;
    const body = await r.json();
    if (!r.ok) {
      if (
        r.status === 401 ||
        r.status === 403 ||
        body.code === "WORKSPACE_CHANGED"
      )
        invalidate(body.message ?? "O acesso ao workspace mudou.");
      throw Error(body.message ?? "Não foi possível carregar.");
    }
    publish(validate(body, snapshot.workspaceId), true);
  }
  function send(
    command: WorkspaceCommand,
    explicitId?: string,
  ): Promise<ConfirmationResult | undefined> {
    const key = JSON.stringify(command);
    const retry = pending.has(key);
    if (access.kind === "blocked" || (access.kind === "conflict" && !retry))
      return Promise.reject(Error(access.message));
    const ticket = generation;
    const entry = pending.get(key) ?? {
      requestId: explicitId ?? crypto.randomUUID(),
      expectedRevision: undefined as number | undefined,
    };
    const requestId = entry.requestId;
    pending.set(key, entry);
    let dispatched = false;
    const operation = queue.then(async () => {
      try {
        if (disposed) throw Error("O workspace foi alterado.");
        if (ticket !== generation)
          throw Error(
            "Operação cancelada após uma falha anterior. Revise e tente novamente.",
          );
        if (access.kind === "blocked" || (access.kind === "conflict" && !retry))
          throw Error(access.message);
        dispatched = true;
        entry.expectedRevision ??= snapshot.revision;
        const response = await transport("/api/workspace/commands", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-cadence-workspace": snapshot.workspaceId,
          },
          body: JSON.stringify({
            requestId,
            expectedRevision: entry.expectedRevision,
            command,
          }),
        });
        const body = await response.json();
        if (!response.ok) {
          if (response.status < 500) pending.delete(key);
          if (
            response.status === 401 ||
            response.status === 403 ||
            body.code === "WORKSPACE_CHANGED"
          )
            invalidate(body.message ?? "O acesso ao workspace mudou.");
          else if (response.status === 409) await refresh();
          throw Error(
            response.status === 401
              ? "Sua sessão venceu. Entre novamente em outra aba e salve sua edição."
              : (body.message ?? "Não foi possível salvar."),
          );
        }
        publish(validate(body.snapshot, snapshot.workspaceId));
        options.onLocalCommit?.();
        pending.delete(key);
        return body.result as ConfirmationResult | undefined;
      } catch (e) {
        if (!dispatched && !retry) pending.delete(key);
        if (ticket === generation) generation++;
        throw e;
      }
    });
    queue = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }
  const repo: AsyncRepository = {
    getSnapshot: () => snapshot.data,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    upsertLead: async (lead) => {
      await send({ type: "lead.upsert", lead });
    },
    importLeads: async (leads, list, options) => {
      await send({ type: "leads.import", leads, ...(list ? { list } : {}),...(options?{dedupScope:options.dedupScope}:{}) });
    },
    saveLeadBatch: async (leads, options) => {
      await send({ type: "leads.batch", leads, ...options });
    },
    deleteLeads: async (ids) => {
      await send({ type: "leads.delete", ids });
    },
    confirmAutomationPlan: async (plan, requestId) =>
      (await send({ type: "audience.confirm", plan }, requestId))!,
    saveCadenceDraft: async (cadence) => {
      await send({ type: "cadence.saveDraft", cadence });
    },
    saveContext: async (profile) => {
      await send({
        type: profile.approvedAt ? "context.approve" : "context.saveDraft",
        profile,
      });
    },
    saveTemplate: async (template) => {
      await send({ type: "template.save", template });
    },
    deleteTemplate: async (id) => {
      await send({ type: "template.delete", id });
    },
    saveAutomation: async (automation, list) => {
      await send({
        type: "automation.save",
        automation,
        ...(list ? { list } : {}),
      });
    },
    updatePreferences: async (preferences) => {
      await send({ type: "preferences.update", preferences });
    },
    addJob: async (job) => {
      await send({ type: "demoJob.record", job });
    },
    reset: async () => {
      throw Error("A restauração é exclusiva da demonstração.");
    },
  };
  return {
    ...repo,
    snapshot: () => snapshot,
    access: () => access,
    refresh,
    invalidateAccess: invalidate,
    dispose() {
      controller.abort();
      disposed = true;
      listeners.clear();
    },
  };
}
