import type {PoolClient} from 'pg';
import type {QualificationDay} from '../../domain/billing.ts';

export async function readQualificationDay(c:PoolClient,listId?:string,leadIds:string[]=[]):Promise<QualificationDay|null>{
 const {rows}=await c.query('SELECT app.qualification_daily_balance($1,$2) AS balance',[listId??null,JSON.stringify(leadIds)]);
 return rows[0].balance;
}
