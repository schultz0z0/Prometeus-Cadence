import {z} from 'zod';
// 07A.3c: AI-written comments wait for a person. LinkedIn accepts comments of up to 1,250 characters.
export const COMMENT_MAX=1250;
export const approveSchema=z.strictObject({body:z.string().trim().min(1).max(COMMENT_MAX),expectedRevision:z.number().int().min(1),requestId:z.uuid()});
export const rejectSchema=z.strictObject({expectedRevision:z.number().int().min(1)});
export type ApprovalState='pending'|'posting'|'posted'|'uncertain'|'failed'|'rejected'|'expired'|'cancelled';
export interface LinkedinApprovalView{id:string;revision:number;state:ApprovalState;body:string;aiBody:string;
 post:{text:string;url:string|null;date:string|null};person:{id:string;name:string;headline:string|null;company:string|null};campaign:{id:string;name:string};
 createdAt:string;expiresAt:string;decidedAt:string|null}
