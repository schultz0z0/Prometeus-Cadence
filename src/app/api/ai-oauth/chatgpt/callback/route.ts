import {chatgptCallbackHttp} from '@/server/ai-oauth/http';
export const runtime='nodejs';
export async function GET(request:Request){return chatgptCallbackHttp(request);}
