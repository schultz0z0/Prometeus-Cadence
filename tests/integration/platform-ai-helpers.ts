import type {Principal} from '../../src/domain/workspace.ts';import {testAdmin} from './prospecting-helpers.ts';import {after} from 'node:test';
const ownedScopes=new Set<string>();
after(async()=>{if(ownedScopes.size)await testAdmin(c=>c.query('DELETE FROM app.platform_ai_control WHERE workspace_id=ANY($1::text[])',[[...ownedScopes]]));});
export async function configurePlatformAiTest(p:Principal){
 ownedScopes.add(p.workspaceId);
 process.env.PLATFORM_AI_WORKSPACE_ID=p.workspaceId;process.env.PLATFORM_AI_ADMIN_USER_IDS=p.userId;
 await testAdmin(c=>c.query('INSERT INTO app.platform_ai_control VALUES(true,$1,$2) ON CONFLICT(singleton) DO UPDATE SET workspace_id=EXCLUDED.workspace_id,admin_user_ids=EXCLUDED.admin_user_ids',[p.workspaceId,[p.userId]]));
}
