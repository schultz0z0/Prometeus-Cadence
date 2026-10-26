import type {
  DemoState,
  Lead,
  LeadList,
  AudiencePlan,
  ConfirmationResult,
  Cadence,
  CompanyProfile,
  Template,
  Automation,
  DemoPreferences,
  DemoJob,
} from "./model.ts";
export interface DemoRepository {
  getSnapshot(): DemoState;
  subscribe(listener: () => void): () => void;
  upsertLead(lead: Lead): void;
  importLeads(leads: Lead[], list?: LeadList, options?:{dedupScope:'list'|'workspace'}): void;
  saveLeadBatch(
    leads: Lead[],
    options: { mode: "import" | "update"; list?: LeadList; job?: DemoJob },
  ): void;
  confirmAutomationPlan(
    plan: AudiencePlan,
    requestId: string,
  ): ConfirmationResult;
  saveCadenceDraft(cadence: Cadence): void;
  saveContext(profile: CompanyProfile): void;
  saveTemplate(template: Template): void;
  deleteTemplate(id: string): void;
  saveAutomation(automation: Automation, list?: LeadList): void;
  updatePreferences(prefs: Partial<DemoPreferences>): void;
  addJob(job: DemoJob): void;
  deleteLeads(ids: string[]): void;
  reset(): void;
}
