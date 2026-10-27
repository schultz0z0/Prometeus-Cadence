import { z } from "zod";
const id = z.string().min(1).max(120),
  text = z.string().max(20000),
  name = z.string().trim().min(1).max(250),
  date = z.iso.datetime({ offset: true });
const source = z.enum([
    "MAPS",
    "WEB",
    "CNPJ",
    "APOLLO",
    "QUALIFY",
    "REENGAGE",
    "MANUAL",
  ]),
  qual = z.enum(["qualified", "pending", "warning", "disqualified"]),
  channel = z.enum(["EMAIL", "WHATSAPP", "LINKEDIN"]);
const strings = z.array(text).max(100),
  weekdays = z.array(z.int().min(0).max(6)).max(7),
  time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone = z
    .string()
    .max(100)
    .refine((s) => {
      try {
        new Intl.DateTimeFormat("pt-BR", { timeZone: s });
        return true;
      } catch {
        return false;
      }
    }),
  filters = z.record(z.string().max(100), z.string().max(2000));
const interval = z
  .tuple([z.number().min(1).max(86400), z.number().min(1).max(86400)])
  .refine((v) => v[1] >= v[0]);
const list = z.strictObject({ id, name });
const lead = z.strictObject({
  id,
  listId: id,
  name,
  companyName: text.optional(),
  email: z.string().max(254).optional(),
  phone: z.string().max(80).optional(),
  site: z.string().max(2000).optional(),
  city: z.string().max(200).optional(),
  state: z.string().max(50).optional(),
  cnpj: z.string().max(30).optional(),
  instagram: z.string().max(2000).optional(),
  facebook: z.string().max(2000).optional(),
  linkedin: z.string().max(2000).optional(),
  whatsapp: z.string().max(80).optional(),
  address: z.string().max(2000).optional(),
  size: z.string().max(2000).optional(),
  cnae: z.string().max(2000).optional(),
  capital: z.string().max(2000).optional(),
  legalNature: z.string().max(2000).optional(),
  openedAt: z.string().max(2000).optional(),
  rating: z.string().max(2000).optional(),
  reviewCount: z.string().max(2000).optional(),
  customFields:z.record(z.string().trim().min(1).max(100).refine(v=>!['__proto__','prototype','constructor'].includes(v)),z.string().max(2000)).refine(v=>Object.keys(v).length<=30).optional(),
  qualification: qual,
  reason: text.optional(),
  source,
  summary: text.optional(),
  favorite: z.boolean().optional(),
  createdAt: date,
});
const profile = z.strictObject({
  id,
  version: z.int().min(0),
  domain: text,
  name: text,
  offer: text,
  products: text,
  idealCustomer: text,
  pains: text,
  differentiators: text,
  competitors: text,
  socialProof: text,
  sources: text,
  approvedAt: date.nullable(),
});
const settings = z.strictObject({
  timezone,
  weekdays,
  sendTime: time,
  skipHolidays: z.boolean(),
  intervalSeconds: interval,
  whatsappIntervalSeconds: interval,
  budgetPercent: z.number().min(0).max(100).nullable(),
  stopOnReply: z.boolean(),
  stopKeywords: strings,
  bounceLimit: z.number().min(1).max(100),
  acceptedQualifications: z.array(qual).max(4),
  distribute: z.boolean(),
  corporateOnly: z.boolean(),
  excludeReplied: z.boolean(),
  alternateContact: z.boolean(),
  reengage: z.boolean(),
  pauseOnBounce: z.boolean(),
  resume: z.enum(["tomorrow", "hours", "manual"]),
});
const origin=z.strictObject({kind:z.enum(['manual','planning']),jobId:id.optional(),optionId:id.optional(),contextVersion:z.int().min(0).optional(),productId:id.optional(),productVersion:z.int().min(0).nullable().optional()});
const cadence = z.strictObject({
  id,
  name,
  listId: id,
  status: z.enum(["draft", "paused", "active", "completed"]),
  steps: z
    .array(
      z.strictObject({
        id,
        channel,
        delayDays: z.number().min(0).max(365),
        subject: text.optional(),
        body: text,
        aiInstructions: text.optional(),
        stopOnReply: z.boolean(),
        attachmentIds:z.array(id).max(5).refine(v=>new Set(v).size===v.length).optional(),
        variantB:z.strictObject({body:text,subject:z.string().max(200).optional(),attachmentIds:z.array(id).max(5).refine(v=>new Set(v).size===v.length).optional()}).optional(),
      }),
    )
    .max(30),
  settings,
  createdAt: date,
  archived: z.boolean().optional(),
  origin: origin.optional(),
});
const automation = z.strictObject({
  id,
  name,
  description: text,
  listId: id,
  source,
  status: z.enum(["draft", "paused", "active", "error"]),
  schedule: z.strictObject({
    frequency: z.enum([
      "once",
      "daily",
      "weekly",
      "biweekly",
      "monthly",
      "custom",
    ]),
    time,
    timezone,
    weekdays,
    anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    monthDay: z.int().min(1).max(31).optional(),
    intervalDays: z.int().min(1).max(365).optional(),
  }),
  dailyLimit: z.int().min(1).max(10000),
  filters,
  modules: strings,
  createdAt: date,
  criteria: z.string().max(4000).optional(),
  dependsOnAutomationId: id.optional(),
  origin: origin.optional(),
});
const template = z.strictObject({
  id,
  name,
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  tags: strings,
  subject: text.optional(),
  body: text,
});
const preferences = z.strictObject({
  accountName: z.string().max(100).optional(),
  company: z.string().max(100).optional(),
  timezone: timezone.optional(),
  billingEmail: z.string().max(254).optional(),
  dailyReport: z.boolean().optional(),
  weeklyReport: z.boolean().optional(),
  monthlyReport: z.boolean().optional(),
  notifyEmail: z.boolean().optional(),
  notifyWhatsapp: z.boolean().optional(),
  onboardingHidden: z.boolean().optional(),
});
const job = z.strictObject({
  id,
  name,
  type: z.enum(["generation", "qualification", "enrichment"]),
  status: z.enum(["completed", "cancelled"]),
  count: z.int().min(0).max(10000),
  demo: z.literal(true),
  billableUsage: z.literal(0),
  createdAt: date,
  details: text,
});
export const commandSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("leads.batch"),
    leads: z.array(lead).max(500),
    mode: z.enum(["import", "update"]),
    list: list.optional(),
    job: job.optional(),
  }),
  z.strictObject({ type: z.literal("lead.upsert"), lead }),
  z.strictObject({
    type: z.literal("leads.import"),
    leads: z.array(lead).max(500),
    list: list.optional(),
    dedupScope:z.enum(['list','workspace']).optional(),
  }),
  z.strictObject({
    type: z.literal("leads.delete"),
    ids: z.array(id).max(500),
  }),
  z.strictObject({ type: z.literal("cadence.saveDraft"), cadence }),
  z.strictObject({ type: z.literal("context.saveDraft"), profile }),
  z.strictObject({ type: z.literal("context.approve"), profile }),
  z.strictObject({ type: z.literal("template.save"), template }),
  z.strictObject({ type: z.literal("template.delete"), id }),
  z.strictObject({
    type: z.literal("automation.save"),
    automation,
    list: list.optional(),
  }),
  z.strictObject({
    type: z.literal("audience.confirm"),
    plan: z.strictObject({
      id,
      title: name,
      description: text,
      listName: name,
      source,
      filters,
      channel: z.enum(["email", "whatsapp", "both"]),
      marketSize: z.number().min(0).nullable(),
      dailyLimit: z.int().min(1).max(10000),
    }),
  }),
  z.strictObject({ type: z.literal("preferences.update"), preferences }),
  z.strictObject({
    type: z.literal("demoJob.record"),
    job: z.strictObject({
      id,
      name,
      type: z.enum(["generation", "qualification", "enrichment"]),
      status: z.enum(["completed", "cancelled"]),
      count: z.int().min(0).max(10000),
      demo: z.literal(true),
      billableUsage: z.literal(0),
      createdAt: date,
      details: text,
    }),
  }),
]);
export const envelopeSchema = z.strictObject({
  requestId: z.uuid(),
  expectedRevision: z.int().min(0),
  command: commandSchema,
});
