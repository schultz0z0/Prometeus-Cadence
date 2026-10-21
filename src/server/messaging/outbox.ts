import 'server-only';
import type {PoolClient} from 'pg';
import {dispatchPool} from './worker-db.ts';
export async function materializeDueMessages(now:string,limit:number):Promise<number>{
 if(!Number.isFinite(Date.parse(now))||!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid materialization limit');
 return Number((await dispatchPool().query('SELECT app.materialize_cadence_messages($1,$2) AS count',[now,limit])).rows[0].count);
}
export async function stopPendingForIdentity(c:PoolClient,identityId:string,reason:'reply'|'optout'):Promise<void>{await c.query('SELECT app.stop_reviewed_identity($1,$2)',[identityId,reason]);}
