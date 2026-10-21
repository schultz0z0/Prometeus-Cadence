import 'server-only';
import type {DispatchLease,Receipt} from '../../domain/whatsapp.ts';
import {dispatchPool} from './worker-db.ts';
export async function recordDispatchReceipt(lease:DispatchLease,receipt:Receipt,recordedAt=new Date().toISOString()):Promise<void>{
 await dispatchPool().query('SELECT app.record_message_dispatch_receipt($1,$2,$3,$4,$5,$6)',[lease.workspaceId,lease.messageId,lease.attemptId,lease.token,lease.fence,{...receipt,recordedAt}]);
}
