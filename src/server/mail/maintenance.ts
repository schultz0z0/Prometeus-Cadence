import 'server-only';
import {dispatchPool} from '../messaging/worker-db.ts';
export async function pruneMailMetadata(now:string):Promise<{oauthAttempts:number;messages:number}>{
 if(!Number.isFinite(Date.parse(now)))throw Error('INVALID_RETENTION_CLOCK');return (await dispatchPool().query('SELECT app.prune_mail_metadata($1) AS result',[now])).rows[0].result;
}
