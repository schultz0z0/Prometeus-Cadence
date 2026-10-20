import type { Cadence, CadenceStep, Lead, ValidationIssue } from "./model.ts";

export function eligibleCadenceLeads(
  cadence: Cadence,
  leads: readonly Lead[],
): Lead[] {
  return leads.filter(
    (lead) =>
      lead.listId === cadence.listId &&
      cadence.settings.acceptedQualifications.includes(lead.qualification),
  );
}

export function renderStepPreview(
  step: Pick<CadenceStep, "subject" | "body">,
  lead: Lead,
) {
  const subject = renderMessage(step.subject ?? "", lead);
  const body = renderMessage(step.body, lead);
  return {
    subject: subject.text,
    text: body.text,
    unresolved: [...new Set([...subject.unresolved, ...body.unresolved])],
  };
}

export function moveCadenceStep(
  cadence: Cadence,
  edited: CadenceStep,
  direction: -1 | 1,
): Cadence {
  const index = cadence.steps.findIndex((step) => step.id === edited.id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= cadence.steps.length) return cadence;
  const steps = cadence.steps.map((step) =>
    step.id === edited.id ? { ...edited } : step,
  );
  [steps[index], steps[target]] = [steps[target], steps[index]];
  return { ...cadence, steps };
}
export function renderMessage(template: string, lead: Lead) {
  const map: Record<string, string | undefined> = {
    nome: lead.name,
    email: lead.email,
    telefone: lead.phone,
    site: lead.site,
    cidade: lead.city,
    razaoSocial: lead.companyName,
    cnpj: lead.cnpj,
  };
  const unresolved: string[] = [];
  const text = template.replace(
    /\{\{\s*([^{}]+?)\s*\}\}/g,
    (match, key: string) => {
      if (Object.hasOwn(map, key) && map[key]) return map[key]!;
      if (!unresolved.includes(key)) unresolved.push(key);
      return match;
    },
  );
  return { text, unresolved };
}
export function validateCadence(c: Cadence) {
  const issues: ValidationIssue[] = [];
  if (!c.name.trim())
    issues.push({ field: "name", message: "Dê um nome à cadência." });
  if (!c.listId)
    issues.push({ field: "listId", message: "Selecione uma lista." });
  if (!c.steps.length)
    issues.push({
      field: "steps",
      message: "Adicione pelo menos uma mensagem.",
    });
  c.steps.forEach((s, i) => {
    if (!Number.isFinite(s.delayDays) || s.delayDays < 0)
      issues.push({
        field: `steps.${i}.delayDays`,
        message: "A espera deve ser zero ou maior.",
      });
    if (!s.body.trim())
      issues.push({
        field: `steps.${i}.body`,
        message: `Escreva a mensagem da etapa ${i + 1}.`,
      });
  });
  for (const field of ["intervalSeconds", "whatsappIntervalSeconds"] as const) {
    const [min, max] = c.settings[field];
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min)
      issues.push({
        field,
        message: "O intervalo máximo deve ser maior ou igual ao mínimo.",
      });
  }
  if (c.settings.bounceLimit < 3)
    issues.push({
      field: "bounceLimit",
      message: "O limite mínimo é de 3 bounces.",
    });
  if (!c.settings.weekdays.length)
    issues.push({ field: "weekdays", message: "Selecione um dia de envio." });
  return issues;
}
