import{z}from'zod';
export type TotpChallenge={id:string;userId:string;expiresAt:string;verifiedAt:string|null};
export const membershipChangeSchema=z.strictObject({memberId:z.string().min(1).max(120),expectedRevision:z.number().int().min(1),role:z.enum(['owner','admin','operator']),requestId:z.uuid()});
export type MembershipChange=z.infer<typeof membershipChangeSchema>;
export const totpVerificationSchema=z.strictObject({challengeId:z.uuid(),code:z.string().regex(/^[0-9]{6}$/)});
export function canRemoveOwner(input:{targetRole:string;remainingOwners:number}):boolean{
 if(!['owner','admin','operator'].includes(input.targetRole)||!Number.isInteger(input.remainingOwners)||input.remainingOwners<0)return false;
 return input.targetRole!=='owner'||input.remainingOwners>0;
}
