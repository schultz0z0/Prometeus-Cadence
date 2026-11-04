import {mcpConnectionsRequest} from '@/server/mcp/http';
export const runtime='nodejs';
export const GET=(request:Request)=>mcpConnectionsRequest(request);
