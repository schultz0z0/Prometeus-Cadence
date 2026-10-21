import 'server-only';
import type {DispatchLease} from '../../domain/whatsapp.ts';
import {AppError} from '../errors.ts';
import {dispatchPool} from './worker-db.ts';
export const leaseArgs=(lease:DispatchLease)=>[lease.workspaceId,lease.messageId,lease.token,lease.fence];
export async function claimDispatch(now:string,scope?:{workspaceId:string}):Promise<DispatchLease|null>{
 if(!Number.isFinite(Date.parse(now)))throw Error('Invalid clock');
 return (await dispatchPool().query('SELECT app.claim_message_dispatch($1,$2) AS lease',[now,scope?.workspaceId??null])).rows[0].lease;
}
export async function heartbeatDispatch(lease:DispatchLease):Promise<DispatchLease>{
 const until=(await dispatchPool().query('SELECT app.heartbeat_message_dispatch($1,$2,$3,$4) AS until',leaseArgs(lease))).rows[0]?.until;
 if(!until)throw new AppError(409,'A autorização deste envio venceu.','STALE_LEASE');return {...lease,expiresAt:until.toISOString()};
}
