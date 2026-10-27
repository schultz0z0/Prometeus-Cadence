export type Qualification =
  | "qualified"
  | "pending"
  | "warning"
  | "disqualified";
export type Channel = "EMAIL" | "WHATSAPP" | "LINKEDIN";
export type Source =
  | "MAPS"
  | "WEB"
  | "CNPJ"
  | "APOLLO"
  | "QUALIFY"
  | "REENGAGE"
  | "MANUAL";
export interface Lead {
  id: string;
  listId: string;
  name: string;
  companyName?: string;
  email?: string;
  phone?: string;
  site?: string;
  city?: string;
  state?: string;
  cnpj?: string;
  instagram?: string;
  facebook?: string;
  linkedin?: string;
  whatsapp?: string;
  address?: string;
  size?: string;
  cnae?: string;
  capital?: string;
  legalNature?: string;
  openedAt?: string;
  rating?: string;
  reviewCount?: string;
  customFields?: Record<string,string>;
  qualification: Qualification;
  reason?: string;
  source: Source;
  summary?: string;
  favorite?: boolean;
  createdAt: string;
}
export interface LeadList {
  id: string;
  name: string;
}
export interface Schedule {
  frequency: "once" | "daily" | "weekly" | "biweekly" | "monthly" | "custom";
  time: string;
  timezone: string;
  weekdays: number[];
  anchorDate?: string;
  monthDay?: number;
  intervalDays?: number;
}
export interface Automation {
  id: string;
  name: string;
  description: string;
  listId: string;
  source: Source;
  status: "draft" | "paused" | "active" | "error";
  schedule: Schedule;
  dailyLimit: number;
  filters: Record<string, string>;
  modules: string[];
  createdAt: string;
  criteria?: string;
  dependsOnAutomationId?: string;
  origin?: PlanningOrigin;
}
export interface PlanningOrigin{kind:'manual'|'planning';jobId?:string;optionId?:string;contextVersion?:number;productId?:string;productVersion?:number|null}
export interface AudiencePlan {
  id: string;
  title: string;
  description: string;
  listName: string;
  source: Source;
  filters: Record<string, string>;
  channel: "email" | "whatsapp" | "both";
  marketSize: number | null;
  dailyLimit: number;
}
export interface CadenceStep {
  id: string;
  channel: Channel;
  delayDays: number;
  subject?: string;
  body: string;
  aiInstructions?: string;
  stopOnReply: boolean;
  attachmentIds?: string[];
  variantB?: {body:string;subject?:string;attachmentIds?:string[]};
}
export interface CadenceSettings {
  timezone: string;
  weekdays: number[];
  sendTime: string;
  skipHolidays: boolean;
  intervalSeconds: [number, number];
  whatsappIntervalSeconds: [number, number];
  budgetPercent: number | null;
  stopOnReply: boolean;
  stopKeywords: string[];
  bounceLimit: number;
  acceptedQualifications: Qualification[];
  distribute: boolean;
  corporateOnly: boolean;
  excludeReplied: boolean;
  alternateContact: boolean;
  reengage: boolean;
  pauseOnBounce: boolean;
  resume: "tomorrow" | "hours" | "manual";
}
export interface Cadence {
  id: string;
  name: string;
  listId: string;
  status: "draft" | "paused" | "active" | "completed";
  steps: CadenceStep[];
  settings: CadenceSettings;
  createdAt: string;
  archived?: boolean;
  origin?: PlanningOrigin;
}
export interface CadenceBrief {
  listId: string;
  objective: string;
  channels: Channel[];
  tone: string;
  rhythm: string;
  highlight: string;
  avoid: string;
  decisionMaker: string;
  profile: CompanyProfile;
}
export interface Template {
  id: string;
  name: string;
  channel: "EMAIL" | "WHATSAPP";
  tags: string[];
  subject?: string;
  body: string;
}
export interface CompanyProfile {
  id: string;
  version: number;
  domain: string;
  name: string;
  offer: string;
  products: string;
  idealCustomer: string;
  pains: string;
  differentiators: string;
  competitors: string;
  socialProof: string;
  sources: string;
  approvedAt: string | null;
}
export interface DemoPreferences {
  accountName: string;
  company: string;
  timezone: string;
  dailyReport: boolean;
  weeklyReport: boolean;
  monthlyReport: boolean;
  billingEmail: string;
  notifyEmail: boolean;
  notifyWhatsapp: boolean;
  onboardingHidden: boolean;
}
export interface DemoJob {
  id: string;
  name: string;
  type: "generation" | "qualification" | "enrichment";
  status: "completed" | "cancelled";
  count: number;
  demo: true;
  billableUsage: 0;
  createdAt: string;
  details: string;
}
export interface ProspectingRequest {
  source: "MAPS" | "WEB" | "CNPJ" | "APOLLO";
  destination: string;
  filters: Record<string, string>;
  limit: number;
}
export interface QualificationConfig {
  extractEmails: boolean;
  extractPhones: boolean;
  discoverSite: boolean;
  summary: boolean;
  deepExtraction: boolean;
  validateEmail: boolean;
  validateWhatsapp: boolean;
  registry: boolean;
  qualifyAi: boolean;
  language: string;
  limit: number;
}
export interface ConfirmationResult {
  listId: string;
  automationIds: [string, string];
}
export interface DemoState {
  schemaVersion: 1;
  lists: LeadList[];
  leads: Lead[];
  automations: Automation[];
  cadences: Cadence[];
  templates: Template[];
  companyProfile: CompanyProfile;
  preferences: DemoPreferences;
  confirmationResults: Record<string, ConfirmationResult>;
  jobs: DemoJob[];
}
export interface ValidationIssue {
  field: string;
  message: string;
}
export const sourceLabels: Record<Source, string> = {
  MAPS: "Google Maps",
  WEB: "Busca na web",
  CNPJ: "CNPJ por CNAE",
  APOLLO: "Apollo",
  QUALIFY: "Qualificar lista",
  REENGAGE: "Reengajamento",
  MANUAL: "Cadastro manual",
};
export const qualificationLabels: Record<Qualification, string> = {
  qualified: "Qualificado",
  pending: "Pendente",
  warning: "Em alerta",
  disqualified: "Desqualificado",
};
export const qualificationTones: Record<Qualification, string> = {
  qualified: "green",
  pending: "neutral",
  warning: "orange",
  disqualified: "red",
};
