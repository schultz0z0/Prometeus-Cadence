import 'server-only';
import {billingConfig} from './config.ts';
import {billingPool} from './db.ts';
import {processBillingOperation} from './operations.ts';
import {processBillingEvent} from './events.ts';
import {createStripeAdapter,type StripeAdapter} from './stripe.ts';
export async function processBillingTick(options:{limit?:number;signal?:AbortSignal;adapter?:StripeAdapter}={}){
 if(!billingConfig().configured)return {processed:0};const limit=Math.min(10,Math.max(1,Math.trunc(options.limit??5))),adapter=options.adapter??createStripeAdapter();let processed=0;
 await billingPool().query('SELECT app.billing_schedule_sync($1)',[limit]);
 // Alternate durable commands and incoming receipts; neither class can starve the other.
 for(let i=0;i<limit&&!options.signal?.aborted;i++){
  const operation=i%2===0;
  if(await(operation?processBillingOperation(undefined,adapter):processBillingEvent(undefined,adapter))||await(operation?processBillingEvent(undefined,adapter):processBillingOperation(undefined,adapter)))processed++;else break;
 }
 return {processed};
}
