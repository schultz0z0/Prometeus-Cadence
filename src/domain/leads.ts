import type { Lead, Qualification } from "./model.ts";
export interface LeadQuery {
  search?: string;
  listId?: string;
  qualification?: Qualification | "";
  onlyFavorites?: boolean;
  contact?: 'email'|'phone'|'none'|'';
  state?: string;
  source?: string;
  createdFrom?: string;
  createdTo?: string;
  summary?: 'yes'|'no'|'';
  sort?: "name" | "city" | "newest";
}
export function filterLeads(leads: Lead[], q: LeadQuery) {
  const text = (q.search ?? "").trim().toLocaleLowerCase("pt-BR");
  return leads
    .filter(
      (l) =>
        (!q.listId || l.listId === q.listId) &&
        (!q.qualification || l.qualification === q.qualification) &&
        (!q.onlyFavorites || l.favorite) &&
        (!q.contact||(q.contact==='email'?!!l.email?.trim():q.contact==='phone'?!!l.phone?.trim():!l.email?.trim()&&!l.phone?.trim()))&&
        (!q.state||l.state?.toUpperCase()===q.state.toUpperCase())&&
        (!q.source||l.source===q.source)&&
        (!q.createdFrom||Date.parse(l.createdAt)>=Date.parse(q.createdFrom+'T00:00:00Z'))&&
        (!q.createdTo||Date.parse(l.createdAt)<Date.parse(q.createdTo+'T00:00:00Z')+86400000)&&
        (!q.summary||(q.summary==='yes'?!!l.summary?.trim():!l.summary?.trim()))&&
        (!text ||
          [l.name, l.companyName, l.email, l.phone, l.city, l.state, l.site]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase("pt-BR")
            .includes(text)),
    )
    .toSorted((a, b) => (
      q.sort === "name"
        ? a.name.localeCompare(b.name, "pt-BR")
        : q.sort === "city"
          ? (a.city ?? "").localeCompare(b.city ?? "", "pt-BR")
          : Date.parse(b.createdAt)-Date.parse(a.createdAt))||a.id.localeCompare(b.id),
    );
}
