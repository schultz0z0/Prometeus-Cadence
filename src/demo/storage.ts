import type { DemoState } from "../domain/model.ts";
import { createSeed } from "./seed.ts";

export const STORAGE_KEY = "prometeus-cadence-demo-v1";
type Check = (value: unknown) => boolean;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str: Check = (v) => typeof v === "string";
const bool: Check = (v) => typeof v === "boolean";
const num: Check = (v) => typeof v === "number" && Number.isFinite(v);
const oneOf =
  (...values: unknown[]): Check =>
  (v) =>
    values.includes(v);
const optional =
  (check: Check): Check =>
  (v) =>
    v === undefined || check(v);
const nullable =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);
const array =
  (check: Check): Check =>
  (v) =>
    Array.isArray(v) && v.every(check);
const shape =
  (fields: Record<string, Check>): Check =>
  (v) =>
    object(v) && Object.entries(fields).every(([key, check]) => check(v[key]));
const dictionary =
  (check: Check): Check =>
  (v) =>
    object(v) && Object.values(v).every(check);
const strings = array(str);
const qualification = oneOf("qualified", "pending", "warning", "disqualified");
const source = oneOf(
  "MAPS",
  "WEB",
  "CNPJ",
  "APOLLO",
  "QUALIFY",
  "REENGAGE",
  "MANUAL",
);
const channel = oneOf("EMAIL", "WHATSAPP", "LINKEDIN");
const weekdays = array(
  (v) => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 6,
);
const interval: Check = (v) =>
  Array.isArray(v) && v.length === 2 && v.every(num);
const schedule = shape({
  frequency: oneOf("once", "daily", "weekly", "biweekly", "monthly", "custom"),
  time: str,
  timezone: str,
  weekdays,
});
const settings = shape({
  timezone: str,
  weekdays,
  sendTime: str,
  skipHolidays: bool,
  intervalSeconds: interval,
  whatsappIntervalSeconds: interval,
  budgetPercent: nullable(num),
  stopOnReply: bool,
  stopKeywords: strings,
  bounceLimit: num,
  acceptedQualifications: array(qualification),
  distribute: bool,
  corporateOnly: bool,
  excludeReplied: bool,
  alternateContact: bool,
  reengage: bool,
  pauseOnBounce: bool,
  resume: oneOf("tomorrow", "hours", "manual"),
});
const stateCheck = shape({
  schemaVersion: oneOf(1),
  lists: array(shape({ id: str, name: str })),
  leads: array(
    shape({
      id: str,
      listId: str,
      name: str,
      qualification,
      source,
      createdAt: str,
      ...Object.fromEntries(
        [
          "companyName",
          "email",
          "phone",
          "site",
          "city",
          "state",
          "cnpj",
          "instagram", "facebook", "linkedin", "whatsapp", "address", "size", "cnae",
          "capital", "legalNature", "openedAt", "rating", "reviewCount",
          "reason",
          "summary",
        ].map((k) => [k, optional(str)]),
      ),
      favorite: optional(bool),
      customFields:optional(dictionary(str)),
    }),
  ),
  automations: array(
    shape({
      id: str,
      name: str,
      description: str,
      listId: str,
      source,
      status: oneOf("draft", "paused", "active", "error"),
      schedule,
      dailyLimit: num,
      filters: dictionary(str),
      modules: strings,
      createdAt: str,
    }),
  ),
  cadences: array(
    shape({
      id: str,
      name: str,
      listId: str,
      status: oneOf("draft", "paused", "active", "completed"),
      settings,
      createdAt: str,
      archived: optional(bool),
      steps: array(
        shape({
          id: str,
          channel,
          delayDays: num,
          subject: optional(str),
          body: str,
          aiInstructions: optional(str),
          stopOnReply: bool,
        }),
      ),
    }),
  ),
  templates: array(
    shape({
      id: str,
      name: str,
      channel: oneOf("EMAIL", "WHATSAPP"),
      tags: strings,
      subject: optional(str),
      body: str,
    }),
  ),
  companyProfile: shape({
    ...Object.fromEntries(
      [
        "id",
        "domain",
        "name",
        "offer",
        "products",
        "idealCustomer",
        "pains",
        "differentiators",
        "competitors",
        "socialProof",
        "sources",
      ].map((k) => [k, str]),
    ),
    version: num,
    approvedAt: nullable(str),
  }),
  preferences: shape({
    ...Object.fromEntries(
      ["accountName", "company", "timezone", "billingEmail"].map((k) => [
        k,
        str,
      ]),
    ),
    ...Object.fromEntries(
      [
        "dailyReport",
        "weeklyReport",
        "monthlyReport",
        "notifyEmail",
        "notifyWhatsapp",
        "onboardingHidden",
      ].map((k) => [k, bool]),
    ),
  }),
  confirmationResults: dictionary(
    shape({
      listId: str,
      automationIds: (v) => Array.isArray(v) && v.length === 2 && v.every(str),
    }),
  ),
  jobs: array(
    shape({
      id: str,
      name: str,
      type: oneOf("generation", "qualification", "enrichment"),
      status: oneOf("completed", "cancelled"),
      count: num,
      demo: oneOf(true),
      billableUsage: oneOf(0),
      createdAt: str,
      details: str,
    }),
  ),
});

export function decodeDemoState(
  raw: string | null,
): { ok: true; value: DemoState } | { ok: false; reason: string } {
  if (raw === null) return { ok: true, value: createSeed() };
  try {
    const state: unknown = JSON.parse(raw);
    if (!object(state) || state.schemaVersion !== 1)
      return {
        ok: false,
        reason: "A versão dos dados locais não é compatível.",
      };
    if (!stateCheck(state))
      return {
        ok: false,
        reason: "Os dados locais estão incompletos ou têm campos inválidos.",
      };
    return { ok: true, value: state as unknown as DemoState };
  } catch {
    return {
      ok: false,
      reason: "Não foi possível ler os dados salvos neste navegador.",
    };
  }
}
