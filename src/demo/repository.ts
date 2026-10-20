import type { DemoState, ConfirmationResult } from "../domain/model.ts";
import type { DemoRepository } from "../domain/repository.ts";
import { createSeed } from "./seed.ts";
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach((v) => {
      if (v && typeof v === "object" && !Object.isFrozen(v)) freeze(v);
    });
  }
  return value;
}
export function createDemoRepository(
  initial: DemoState = createSeed(),
  persist?: (state: DemoState) => void,
): DemoRepository {
  let state = freeze(structuredClone(initial));
  const listeners = new Set<() => void>();
  const commit = (mutate: (next: DemoState) => void) => {
    const next = structuredClone(state);
    mutate(next);
    persist?.(next);
    state = freeze(next);
    listeners.forEach((fn) => fn());
  };
  return {
    getSnapshot: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    upsertLead(lead) {
      commit((s) => {
        const i = s.leads.findIndex((x) => x.id === lead.id);
        if (i < 0) s.leads.push(lead);
        else s.leads[i] = lead;
      });
    },
    confirmAutomationPlan(plan, requestId) {
      if (!requestId) throw Error("Confirmação sem identificador.");
      if (Object.hasOwn(state.confirmationResults, requestId))
        return state.confirmationResults[requestId];
      if (!plan.listName.trim() || !plan.title.trim())
        throw Error("Dê um nome ao público.");
      const result: ConfirmationResult = {
        listId: crypto.randomUUID(),
        automationIds: [crypto.randomUUID(), crypto.randomUUID()],
      };
      commit((s) => {
        s.lists.push({ id: result.listId, name: plan.listName });
        for (const [i, source] of [plan.source, "QUALIFY" as const].entries())
          s.automations.push({
            id: result.automationIds[i],
            name: `${i === 0 ? "Buscar" : "Qualificar"} · ${plan.title}`,
            description: plan.description,
            listId: result.listId,
            source,
            status: "paused",
            schedule: {
              frequency: "daily",
              time: i === 0 ? "07:00" : "08:00",
              timezone: s.preferences.timezone,
              weekdays: [1, 2, 3, 4, 5],
            },
            dailyLimit: plan.dailyLimit,
            filters: { ...plan.filters, channel: plan.channel },
            modules:
              i === 0
                ? []
                : [
                    "Qualificação por IA",
                    "Resumo com IA",
                    ...(plan.channel !== "whatsapp" ? ["Extrair e-mails"] : []),
                    ...(plan.channel !== "email" ? ["Extrair telefones"] : []),
                  ],
            createdAt: new Date().toISOString(),
          });
        s.confirmationResults[requestId] = result;
      });
      return result;
    },
    importLeads(leads, list) {
      commit((s) => {
        if (list && !s.lists.some((l) => l.id === list.id)) s.lists.push(list);
        const ids = new Set(s.leads.map((l) => l.id));
        for (const lead of leads) {
          if (!ids.has(lead.id)) {
            s.leads.push(lead);
            ids.add(lead.id);
          }
        }
      });
    },
    saveCadenceDraft(cadence) {
      commit((s) => {
        const draft = { ...cadence, status: "draft" as const };
        const i = s.cadences.findIndex((c) => c.id === cadence.id);
        if (i < 0) s.cadences.push(draft);
        else s.cadences[i] = draft;
      });
    },
    saveContext(profile) {
      commit((s) => {
        s.companyProfile = profile;
      });
    },
    saveTemplate(template) {
      commit((s) => {
        const i = s.templates.findIndex((t) => t.id === template.id);
        if (i < 0) s.templates.push(template);
        else s.templates[i] = template;
      });
    },
    deleteTemplate(id) {
      commit((s) => {
        s.templates = s.templates.filter((t) => t.id !== id);
      });
    },
    saveAutomation(auto, list) {
      commit((s) => {
        if (list && !s.lists.some((l) => l.id === list.id)) s.lists.push(list);
        const i = s.automations.findIndex((t) => t.id === auto.id);
        if (i < 0) s.automations.push(auto);
        else s.automations[i] = auto;
      });
    },
    updatePreferences(prefs) {
      commit((s) => {
        s.preferences = { ...s.preferences, ...prefs };
      });
    },
    addJob(job) {
      commit((s) => {
        s.jobs.unshift(job);
      });
    },
    deleteLeads(ids) {
      commit((s) => {
        s.leads = s.leads.filter((l) => !ids.includes(l.id));
      });
    },
    reset() {
      const next = createSeed();
      persist?.(next);
      state = freeze(next);
      listeners.forEach((fn) => fn());
    },
  };
}
