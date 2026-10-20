import type { Automation, Schedule } from "./model.ts";
import type { DemoRepository } from "./repository.ts";

export function createManualAutomationOperation(repo: {saveAutomation:(...args:Parameters<DemoRepository['saveAutomation']>)=>void|Promise<void>}) {
  const id = crypto.randomUUID();
  const newListId = crypto.randomUUID();
  let confirmed = false;
  let inFlight:Promise<string>|undefined;
  return {
    confirm(
      input: Omit<Automation, "id" | "listId">,
      destination: string | { name: string },
    ): Promise<string> {
      if (inFlight) return inFlight;
      if (confirmed) return Promise.resolve(id);
      const list =
        typeof destination === "string"
          ? undefined
          : { id: newListId, name: destination.name };
      const listId = typeof destination === "string" ? destination : newListId;
      if (!listId || !input.name.trim())return Promise.reject(Error("Informe o nome e a lista de destino."));
      try{const saved=repo.saveAutomation({ ...input, id, listId, status: "paused" }, list);
       inFlight=Promise.resolve(saved).then(()=>{confirmed=true;return id;}).finally(()=>{inFlight=undefined;});return inFlight;
      }catch(e){return Promise.reject(e);}
    },
  };
}

export interface AutomationQuery {
  frequency?: Schedule["frequency"] | "";
  module?: string;
}

export function filterAutomations(
  items: readonly Automation[],
  query: AutomationQuery,
): Automation[] {
  return items.filter(
    (item) =>
      (!query.frequency || item.schedule.frequency === query.frequency) &&
      (!query.module || item.modules.includes(query.module)),
  );
}
