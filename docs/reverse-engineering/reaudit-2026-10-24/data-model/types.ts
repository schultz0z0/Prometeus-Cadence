// Logical UI-derived sketch, not the reference database schema.
// Evidence: EV-004, EV-007, EV-027, EV-043, EV-067.
export interface PlanOffer { code: 'essential'|'pro'; cycle: 'month'|'year'; amountBrl: number; extractionAllowance: number; importAllowance: number; seats: number; mailboxes: number; whatsappNumbers: number; }
export interface CreditBalance { unit: 'enrichment'; planRemaining: number; purchasedRemaining: number; planReset: string; }
export interface BillingContact { email: string|null; phone: string|null; }
export interface LinkedInCampaign { state: 'draft'|'active'|'paused'; inviteNote: string; dailyTarget: number; acceptedListId: string|null; }
export interface SdrConversation { channel: 'email'|'whatsapp'|'linkedin'; reviewRequired: boolean; handoffReason: string|null; }
