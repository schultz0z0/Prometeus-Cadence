import type {PoolClient} from 'pg';
import type {AiRoute} from '../../../domain/ai-routing.ts';
import {validConnectionCheck} from '../../../domain/ai-routing.ts';
import {conventionalConfig} from './config.ts';import {readAiPolicy,requireAiAdmin} from './settings.ts';import {readConnectionCheck} from './connection.ts';import {AppError} from '../../errors.ts';
import {assertAutomationAuthority} from '../../automations/guard.ts';
export async function assertAiRouteCurrent(c:PoolClient,job:any,freshOperationId?:string){
 if(job.checkpoint.purpose==='ai-connection-test')await requireAiAdmin(c);
 await assertAutomationAuthority(c,job,'dispatch',freshOperationId);
 const route=job.checkpoint.execution?.aiRoute as AiRoute|undefined,runtime=conventionalConfig(job.workspace_id);
 if(!route)throw new AppError(409,'Esta execução de IA é anterior ao roteamento. Prepare uma nova revisão.','AI_ROUTE_LEGACY');
 const policy=await readAiPolicy(c),entry=runtime.conventional[route.conventional.provider];
 if(policy.revision!==route.policyRevision||!entry.configured||entry.route.configFingerprint!==route.conventional.configFingerprint)throw new AppError(409,'A configuração de IA mudou. Prepare uma nova execução.','AI_ROUTE_CHANGED');
 if(route.decisionProvider==='jev'&&(!runtime.jevReady||!policy.jevEnabled||!validConnectionCheck(route.conventional,await readConnectionCheck(c,route.conventional,freshOperationId))))throw new AppError(409,'A conexão convencional precisa ser testada antes do JEV.','AI_COMPANION_UNAVAILABLE');
}
