import type { Automation, Schedule } from "./model.ts";
import type { DemoRepository } from "./repository.ts";

export function createManualAutomationOperation(repo: DemoRepository) {
  const id = crypto.randomUUID();
  const newListId = crypto.randomUUID();
  let confirmed = false;
  return {
    confirm(
      input: Omit<Automation, "id" | "listId">,
      destination: string | { name: string },
    ): string {
      if (confirmed) return id;
      const list =
        typeof destination === "string"
          ? undefined
          : { id: newListId, name: destination.name };
      const listId = typeof destination === "string" ? destination : newListId;
      if (!listId || !input.name.trim())
        throw Error("Informe o nome e a lista de destino.");
      repo.saveAutomation({ ...input, id, listId, status: "paused" }, list);
      confirmed = true;
      return id;
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
