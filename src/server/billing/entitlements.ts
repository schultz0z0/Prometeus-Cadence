import type {PoolClient} from 'pg';
import type {CommercialUnit} from '../../domain/billing.ts';
import {billingError} from './db.ts';
async function call(c:PoolClient,sql:string,args:unknown[]){try{await c.query(sql,args);}catch(e){billingError(e);}}
export function assertExecution(c:PoolClient){return call(c,'SELECT app.billing_require_execution()',[]);}
export function reserveCommercial(c:PoolClient,key:string,unit:CommercialUnit,n:number){return call(c,'SELECT app.billing_reserve($1,$2,$3)',[key,unit,n]);}
export function consumeCommercial(c:PoolClient,key:string,unit:CommercialUnit,n:number,reservationKey?:string){return call(c,'SELECT app.billing_consume($1,$2,$3,$4)',[key,unit,n,reservationKey??null]);}
export function releaseCommercial(c:PoolClient,key:string){return call(c,'SELECT app.billing_release($1)',[key]);}
