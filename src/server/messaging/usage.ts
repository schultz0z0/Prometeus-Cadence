import 'server-only';
import type {Principal} from '../../domain/workspace.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
export async function readMessageUsage(p:Principal):Promise<{reserved:number;consumed:number;costUsd:number|null}>{return withWorkspaceTransaction(p,async c=>{
 const row=(await c.query("SELECT COALESCE(sum(units*CASE WHEN event='release' THEN -1 WHEN event='reserve' THEN 1 ELSE 0 END),0) AS reserved,COALESCE(sum(units) FILTER(WHERE event='consume'),0) AS consumed,CASE WHEN count(*) FILTER(WHERE event='consume' AND cost_kind='unknown')>0 THEN NULL ELSE sum(cost_usd) FILTER(WHERE event='consume') END AS cost FROM app.message_usage_ledger")).rows[0];return {reserved:Number(row.reserved),consumed:Number(row.consumed),costUsd:row.cost===null?null:Number(row.cost)};
});}
