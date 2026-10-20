import type { ProspectingRequest, Lead, DemoJob } from "../domain/model.ts";
export function createGenerationIdentity() {
  return {
    listId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    leadIds: Array.from({ length: 20 }, () => crypto.randomUUID()),
    createdAt: new Date().toISOString(),
  };
}
export function prepareSimulatedGeneration(
  request: ProspectingRequest,
  listName: string | undefined,
  identity: ReturnType<typeof createGenerationIdentity>,
) {
  const result = simulateProspecting(request);
  const leads = result.leads.map((l, i) => ({
    ...l,
    id: identity.leadIds[i],
    createdAt: identity.createdAt,
  }));
  const job: DemoJob = {
    id: identity.jobId,
    name: `Geração · ${listName || request.filters.term}`,
    type: "generation",
    status: "completed",
    count: leads.length,
    demo: true,
    billableUsage: 0,
    createdAt: identity.createdAt,
    details: "Dados fictícios de demonstração. Nenhum provedor foi consultado.",
  };
  return {
    leads,
    list: listName ? { id: request.destination, name: listName } : undefined,
    job,
  };
}
export function simulateProspecting(request: ProspectingRequest) {
  const count = Math.min(20, Math.max(0, Math.floor(request.limit)));
  const leads: Lead[] = Array.from({ length: count }, (_, i) => ({
    id: crypto.randomUUID(),
    listId: request.destination,
    name: `${request.filters.term || "Empresa"} · Exemplo ${i + 1}`,
    site: `exemplo${i + 1}.example`,
    email: i % 3 === 0 ? undefined : `contato@exemplo${i + 1}.example`,
    phone: i % 2 === 0 ? undefined : "(00) 00000-0000",
    city: request.filters.location || "Não informado",
    qualification: "pending",
    source: request.source,
    createdAt: new Date().toISOString(),
    summary:
      "Resultado fictício de uma simulação local. Não corresponde a uma empresa real.",
  }));
  return { demo: true as const, billableUsage: 0 as const, leads };
}
