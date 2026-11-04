import {mcpMetadataRequest} from '@/server/mcp/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>mcpMetadataRequest(request,'resource');
