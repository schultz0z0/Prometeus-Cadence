import 'server-only';
import type {PoolClient} from 'pg';
import {dispatchPool} from './worker-db.ts';
import {nextStepAt} from './schedule.ts';
export async function materializeDueMessages(now:string,limit:number,workspaceId?:string):Promise<number>{
 if(!Number.isFinite(Date.parse(now))||!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid materialization limit');
 const schedules=(await dispatchPool().query('SELECT app.list_enrollment_schedules($1,$2) AS schedules',[limit,workspaceId??null])).rows[0].schedules;
 for(const pending of schedules){
  const step=pending.cadence.steps[pending.nextStep],settings=pending.cadence.settings;
  const next=nextStepAt({anchorAt:pending.acceptedAt,delayDays:step.delayDays,now,timezone:settings.timezone,weekdays:settings.weekdays,sendTime:settings.sendTime,skipHolidays:settings.skipHolidays,holidayDates:null});
  await dispatchPool().query('SELECT app.finish_enrollment_schedule($1,$2,$3,$4,$5)',[pending.workspaceId,pending.enrollmentId,pending.nextStep,pending.acceptedAt,next]);
 }
 return Number((await dispatchPool().query('SELECT app.materialize_cadence_messages($1,$2,$3) AS count',[now,limit,workspaceId??null])).rows[0].count);
}
export async function stopPendingForIdentity(c:PoolClient,identityId:string,reason:'reply'|'optout'):Promise<void>{await c.query('SELECT app.stop_reviewed_identity($1,$2)',[identityId,reason]);}
