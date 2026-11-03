import type {PoolClient} from 'pg';
import {prospectingConfig,parseCaps} from './config.ts';
// An explicit APOLLO_MAX_PAGES (0 included) always wins: it is the operator's kill switch. Without it, a customer's own key gets 5 pages.
export const apolloMaxPages=(own:boolean)=>process.env.APOLLO_MAX_PAGES===undefined||process.env.APOLLO_MAX_PAGES===''?(own?5:0):Number(process.env.APOLLO_MAX_PAGES);
// The platform Apollo key is lent only to workspaces an operator listed (or '*' explicitly), never by default.
const centralApolloAllowed=(workspaceId:string)=>(process.env.APOLLO_CENTRAL_WORKSPACE_IDS??'').split(',').map(x=>x.trim()).some(x=>x==='*'||x===workspaceId);
export type ApolloCredential='connection'|'central'|null;
export async function workspaceProspectingConfig(c:PoolClient){
 const config=prospectingConfig(),policy=(await c.query('SELECT limits,version FROM app.prospecting_policy')).rows[0]??null;
 if(policy){const own=parseCaps(JSON.stringify(policy.limits));for(const k of Object.keys(config.caps) as (keyof typeof config.caps)[])config.caps[k]=Math.min(config.caps[k],own[k]);}
 // A workspace's own Apollo connection makes the source ready with its key; its revision goes into the job review proof (profileVersion).
 const ws=(await c.query("SELECT current_setting('app.workspace_id',true) ws")).rows[0].ws as string;
 const live=(await c.query("SELECT * FROM app.live_connection('apollo')")).rows[0],apolloConnection=live?{id:live.id as string,revision:Number(live.revision)}:null;
 config.ready.APOLLO=apolloConnection?apolloMaxPages(true)>0:config.ready.APOLLO&&centralApolloAllowed(ws);
 const apolloCredential:ApolloCredential=apolloConnection?'connection':config.ready.APOLLO?'central':null;
 return{config:{...config,apolloConnection,apolloCredential},policy};
}
