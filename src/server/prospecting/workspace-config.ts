import type {PoolClient} from 'pg';
import {prospectingConfig,parseCaps} from './config.ts';

export const apolloMaxPages=(own:boolean)=>own?Number(process.env.APOLLO_MAX_PAGES)||5:Number(process.env.APOLLO_MAX_PAGES??0);
export async function workspaceProspectingConfig(c:PoolClient){
 const config=prospectingConfig(),policy=(await c.query('SELECT limits,version FROM app.prospecting_policy')).rows[0]??null;
 if(policy){const own=parseCaps(JSON.stringify(policy.limits));for(const k of Object.keys(config.caps) as (keyof typeof config.caps)[])config.caps[k]=Math.min(config.caps[k],own[k]);}
 // A workspace's own Apollo connection makes the source ready with its key; its revision goes into the job review proof (profileVersion).
 const live=(await c.query("SELECT * FROM app.live_connection('apollo')")).rows[0],apolloConnection=live?{id:live.id as string,revision:Number(live.revision)}:null;
 if(apolloConnection)config.ready.APOLLO=apolloMaxPages(true)>0;
 return{config:{...config,apolloConnection},policy};
}
