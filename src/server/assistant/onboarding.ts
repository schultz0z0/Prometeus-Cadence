import 'server-only';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import {tourIds} from '../../domain/route-tours.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
// Learning milestones are explicit marks by the user; operational steps stay derived from facts elsewhere.
export async function readOnboarding(p:Principal){
 return withWorkspaceTransaction(p,async c=>({tours:(await c.query('SELECT item,completed_at FROM app.onboarding_progress ORDER BY item')).rows.map(r=>({id:(r.item as string).slice(5),completedAt:r.completed_at.toISOString()}))}));
}
export async function markOnboarding(p:Principal,raw:unknown){
 const parsed=z.strictObject({tour:z.string().max(40)}).safeParse(raw);
 if(!parsed.success||!tourIds.has(parsed.data.tour))throw new AppError(422,'Passeio desconhecido.');
 await withWorkspaceTransaction(p,c=>c.query('SELECT app.mark_onboarding($1)',['tour:'+parsed.data.tour]));
 return readOnboarding(p);
}
