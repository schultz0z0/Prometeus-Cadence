export const executionStatuses = ['success','error','skipped','progress'] as const;
export type ExecutionStatus = typeof executionStatuses[number];
export type ExecutionChannel = 'EMAIL'|'WHATSAPP'|'LINKEDIN';

export interface ExecutionDiaryPage {
  counts: Record<ExecutionStatus,number>;
  total: number;
  page: number;
  timezone: string;
  items: {
    id: string;
    at: string;
    status: ExecutionStatus;
    event: string;
    leadId: string|null;
    lead: string|null;
    cadenceId: string;
    cadence: string|null;
    channel: ExecutionChannel;
    trace: boolean;
  }[];
}
