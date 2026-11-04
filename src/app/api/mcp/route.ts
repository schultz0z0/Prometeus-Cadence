import {mcpRequest} from '@/server/mcp/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const POST=(request:Request)=>mcpRequest(request);
export const GET=(request:Request)=>mcpRequest(request);
export const DELETE=(request:Request)=>mcpRequest(request);
export const OPTIONS=(request:Request)=>mcpRequest(request);
