import type {PoolClient} from 'pg';
import {prospectingConfig,parseCaps} from './config.ts';

export async function workspaceProspectingConfig(c:PoolClient){
 const config=prospectingConfig(),policy=(await c.query('SELECT limits,version FROM app.prospecting_policy')).rows[0]??null;
 if(policy){const own=parseCaps(JSON.stringify(policy.limits));for(const k of Object.keys(config.caps) as (keyof typeof config.caps)[])config.caps[k]=Math.min(config.caps[k],own[k]);}
 return{config,policy};
}
