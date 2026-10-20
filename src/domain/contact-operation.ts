import type { Lead, LeadList } from "./model.ts";
import type { DemoRepository } from "./repository.ts";
type ContactRepository = {
  importLeads: (
    ...a: Parameters<DemoRepository["importLeads"]>
  ) => void | Promise<void>;
  upsertLead: (lead: Lead) => void | Promise<void>;
};
export function createContactOperation(
  repo: ContactRepository,
  lists: LeadList[],
  existing?: Lead,
) {
  const creatingList = !existing && !lists.length;
  const destination = existing?.listId ?? lists[0]?.id ?? crypto.randomUUID();
  const initialLead: Lead = existing ?? {
    id: crypto.randomUUID(),
    name: "",
    listId: destination,
    source: "MANUAL",
    qualification: "pending",
    createdAt: new Date().toISOString(),
  };
  return {
    creatingList,
    destination,
    initialLead,
    async save(draft: Lead, listName: string) {
      const lead = {
        ...draft,
        name: draft.name.trim(),
        listId: creatingList ? destination : draft.listId,
      };
      if (creatingList)
        await repo.importLeads([lead], { id: destination, name: listName });
      else await repo.upsertLead(lead);
    },
  };
}
