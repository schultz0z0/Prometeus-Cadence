import {mcpConnectionRevokeRequest} from '@/server/mcp/http';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){const {id}=await context.params;return mcpConnectionRevokeRequest(request,id);}
