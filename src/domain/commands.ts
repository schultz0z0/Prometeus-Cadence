import type {
  Lead,
  LeadList,
  Cadence,
  CompanyProfile,
  Template,
  Automation,
  AudiencePlan,
  DemoPreferences,
  DemoJob,
} from "./model.ts";
export type WorkspaceCommand =
  | { type: "lead.upsert"; lead: Lead }
  | { type: "leads.import"; leads: Lead[]; list?: LeadList; dedupScope?:'list'|'workspace' }
  | {
      type: "leads.batch";
      leads: Lead[];
      mode: "import" | "update";
      list?: LeadList;
      job?: DemoJob;
    }
  | { type: "leads.delete"; ids: string[] }
  | { type: "cadence.saveDraft"; cadence: Cadence }
  | { type: "context.saveDraft" | "context.approve"; profile: CompanyProfile }
  | { type: "template.save"; template: Template }
  | { type: "template.delete"; id: string }
  | { type: "automation.save"; automation: Automation; list?: LeadList }
  | { type: "audience.confirm"; plan: AudiencePlan }
  | { type: "preferences.update"; preferences: Partial<DemoPreferences> }
  | { type: "demoJob.record"; job: DemoJob };
export interface CommandEnvelope {
  requestId: string;
  expectedRevision: number;
  command: WorkspaceCommand;
}
