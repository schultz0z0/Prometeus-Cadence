import test from 'node:test';
import assert from 'node:assert/strict';
import {createStripeAdapter} from '../src/server/billing/stripe.ts';
const config={key:'sk_test_fixture',webhookSecret:'whsec_fixture',origin:'http://127.0.0.1:3210',apiVersion:'2026-09-30.endive',mode:'test' as const,configured:true};
test('downgrade creates from subscription alone, then marks the owned schedule with its operation',async()=>{
 const calls:{endpoint:string;form:URLSearchParams;key:string|null}[]=[];
 const sub={id:'sub_fixture',schedule:null,items:{data:[{price:{id:'price_pro'},current_period_start:100,current_period_end:200}]}};
 let stored:any={id:'sub_sched_fixture',subscription:sub.id,status:'active',end_behavior:'release',metadata:{},current_phase:{start_date:100,end_date:200},phases:[{start_date:100,end_date:200,items:[{price:'price_pro',quantity:1}]}]};
 const adapter=createStripeAdapter(async(input,init)=>{
  const endpoint=new URL(String(input)).pathname,form=new URLSearchParams(String(init?.body??'')),key=new Headers(init?.headers).get('Idempotency-Key');
  calls.push({endpoint,form,key});
  if(init?.method==='POST'&&endpoint==='/v1/subscription_schedules'){
   if([...form.keys()].some(k=>k!=='from_subscription'))return Response.json({error:{message:'You cannot set metadata if from_subscription is set.'}},{status:400});
   return Response.json({id:stored.id});
  }
  if(init?.method==='POST'){stored={...stored,metadata:{cadence_operation:form.get('metadata[cadence_operation]')}};return Response.json(stored);}
  return Response.json(stored);
 },config);
 await adapter.downgrade(sub,'price_essential','operation1');
 assert.equal(stored.metadata.cadence_operation,'operation1');
 assert.equal(calls.find(c=>c.endpoint==='/v1/subscription_schedules')?.key,'billing:operation1:schedule');
 const update=calls.find(c=>c.form.has('phases[1][items][0][price]'))!;assert.equal(update.form.get('phases[0][end_date]'),'200');assert.equal(update.form.get('phases[1][items][0][price]'),'price_essential');
 // A creation acknowledged remotely before its marking response was received
 // is recovered through the same creation key, without adopting an unowned schedule.
 stored.metadata={};
 await adapter.downgrade({...sub,schedule:stored.id},'price_essential','operation1');
 assert.equal(calls.filter(c=>c.endpoint==='/v1/subscription_schedules').length,2);
});
