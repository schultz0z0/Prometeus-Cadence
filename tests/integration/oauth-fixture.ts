import {after} from 'node:test';
import {unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {oauthStore} from '../../src/server/ai-oauth/store.ts';
const workspaces=new Set<string>();
export function seedOAuthFixture(workspaceId:string){
 workspaces.add(workspaceId);const row=oauthStore.initial(workspaceId);
 oauthStore.save(workspaceId,{...row,revision:1,state:'connected',model:'fixture',clientId:'qa-client',subject:'qa-subject',expiresAt:Date.now()+3600000,scopes:['offline_access','resource.invoke','chatgpt.tokens.use.direct']},{accessToken:'qa-not-live',refreshToken:'qa-not-live-refresh'});
}
after(async()=>{for(const workspaceId of workspaces)await unlink(join(process.cwd(),'.runtime','chatgpt-oauth','connection-'+createHash('sha256').update(workspaceId).digest('hex')+'.json'));});
