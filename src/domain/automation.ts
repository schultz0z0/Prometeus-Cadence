import type { Automation, Schedule } from "./model.ts";

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
