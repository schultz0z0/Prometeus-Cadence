import 'server-only';
import type {SyncBatch,SyncLease} from '../../domain/mail.ts';
import {dispatchPool} from '../messaging/worker-db.ts';
import {syncArgs} from './sync/repository.ts';
import {assertSyncBatch} from './sync/validation.ts';
import {classifyMail,parseDsnFacts} from './classification.ts';
export async function ingestMailBatch(lease:SyncLease,batch:SyncBatch):Promise<void> {
 assertSyncBatch(batch);
 const classified={...batch,messages:batch.messages.map(mail=>{const assessment=classifyMail(mail,mail.headers??{},parseDsnFacts(mail.deliveryStatus));return {...mail,assessment,classification:assessment.kind==='hard-bounce'||assessment.kind==='soft-bounce'?'dsn':assessment.kind};})};
 await dispatchPool().query('SELECT app.commit_mail_sync($1,$2,$3,$4,$5,$6)',[...syncArgs(lease),lease.revision,classified]);
}
