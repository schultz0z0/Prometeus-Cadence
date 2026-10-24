import 'server-only';
import pg from 'pg';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
let pool:pg.Pool|undefined;
export function billingPool(){
 const url=process.env.BILLING_DATABASE_URL;if(!url||new URL(url).username!=='cadence_billing')throw Error('Billing database role required.');
 if(!pool){pool=new pg.Pool({connectionString:url,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:5000,options:'-c search_path=app,public -c statement_timeout=15000'});pool.on('error',()=>{});}return pool;
}
export async function closeBillingPool(){if(pool){await pool.end();pool=undefined;}}
export function billingError(error:unknown):never{
 const message=error instanceof Error?error.message:'';
 const errors:Record<string,[number,string]>={BILLING_REQUIRED:[402,'Ative o teste de7 dias ou contrate uma assinatura válida para executar.'],BILLING_QUOTA:[429,'A franquia e os créditos disponíveis não permitem esta operação.'],BILLING_CAPACITY:[409,'A capacidade do plano foi atingida.'],BILLING_REPLAY_CHANGED:[409,'Esta operação já foi usada com outros dados.'],BILLING_RESERVATION:[409,'A reserva de créditos mudou. Revise a operação.'],TRIAL_ALREADY_USED:[409,'O teste de7 dias já foi utilizado neste workspace.'],SUBSCRIPTION_ACTIVE:[409,'Este workspace já possui assinatura ativa.'],FORBIDDEN:[403,'Seu papel não permite esta alteração.']};
 for(const [code,[status,text]] of Object.entries(errors))if(message===code)throw new AppError(status,text,code);
 throw error;
}
export async function billingTransaction<T>(p:Principal,fn:(c:PoolClient)=>Promise<T>):Promise<T>{try{return await withWorkspaceTransaction(p,fn);}catch(error){return billingError(error);}}
