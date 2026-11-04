import {mcpConsentRequest,mcpOauthRequest} from '@/server/mcp/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Ctx={params:Promise<{action:string}>};
const handle=async(request:Request,context:Ctx)=>{const {action}=await context.params;return action==='consent'?mcpConsentRequest(request):mcpOauthRequest(request,action);};
export const GET=handle;
export const POST=handle;
export const OPTIONS=handle;
