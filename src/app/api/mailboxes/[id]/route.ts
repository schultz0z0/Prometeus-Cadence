import {mailboxHttp} from '../../../../server/mail/http.ts';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return mailboxHttp(request,await context.params);}
