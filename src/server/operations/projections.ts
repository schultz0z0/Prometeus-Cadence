import 'server-only';
import type {PoolClient} from 'pg';import type {Principal} from '../../domain/workspace.ts';
import {parseReportQuery,reportSqlTimezone,type ReportQuery} from '../../domain/reporting.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';import {AppError} from '../errors.ts';
// A browser session must still have this workspace active. A bearer principal (MCP, 07C.3a) has no session: its workspace
// is fixed by the grant and its membership was just re-checked by the transaction, so there is no tab to have changed.
export async function authorizeReport(c:PoolClient,p:Principal){if(p.sessionId==='')return;const session=(await c.query('SELECT app.lock_channel_pilot_session($1) value',[p.sessionId])).rows[0].value;if(session?.workspaceId!==p.workspaceId)throw new AppError(403,'A sessão do relatório mudou ou venceu.');}
export async function ensureReportProjection(c:PoolClient,q:ReportQuery,force=false):Promise<{period:string;revision:number;asOf:string}>{
 const result=(await c.query('SELECT app.ensure_report_projection($1,$2,$3,$4,$5) value',[q.from,q.to,reportSqlTimezone(q.timezone),q.cadenceId??null,force])).rows[0].value;return{...result,revision:Number(result.revision),asOf:new Date(result.asOf).toISOString()};
}
export async function rebuildReportProjection(p:Principal,input:{from:string;to:string}):Promise<{checkpoint:string;rows:number}>{
 let q:ReportQuery;try{q=parseReportQuery({view:'dashboard',...input,timezone:'UTC'});}catch{throw new AppError(422,'Período inválido para reconstrução.');}
 const to=new Date(Math.min(Date.parse(q.to),Date.parse(q.from)+31*86400000)).toISOString();
 return withWorkspaceTransaction(p,async c=>{await authorizeReport(c,p);const role=(await c.query('SELECT app.current_role() role')).rows[0].role;if(!['owner','admin'].includes(role))throw new AppError(403,'Somente administradores reconstroem projeções.');const receipt=await ensureReportProjection(c,{...q,to},true);const rows=Number((await c.query("SELECT count(*) n FROM app.report_daily_projection WHERE projection_version='reports-v1' AND period=$1",[receipt.period])).rows[0].n);return{checkpoint:to,rows};});
}
