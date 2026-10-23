import {gmailCallbackHttp} from '../../../../../server/mail/http.ts';
export const runtime='nodejs';
export async function GET(request:Request){return gmailCallbackHttp(request);}
