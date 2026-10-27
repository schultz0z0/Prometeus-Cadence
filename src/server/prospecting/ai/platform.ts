import type {PoolClient} from 'pg';
export function platformAiWorkspace():string|null{
 const value=process.env.PLATFORM_AI_WORKSPACE_ID?.trim();return value&&/^[\w-]{1,120}$/.test(value)?value:null;
}
export async function isPlatformAiAdmin(c:PoolClient):Promise<boolean>{
 const scope=platformAiWorkspace();return !!scope&&Boolean((await c.query('SELECT app.platform_ai_authority($1) AS allowed',[scope])).rows[0]?.allowed);
}
