import {identityRequest} from '@/server/workspaces/identity-http';
export const runtime = "nodejs";
export async function GET(request: Request) {
  return identityRequest(request);
}
export async function POST(request: Request) {
  return identityRequest(request);
}
