import {mailboxHttp} from '../../../../../server/mail/http.ts';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{id:string;action:string}>}){return mailboxHttp(request,await context.params);}
export async function POST(request:Request,context:{params:Promise<{id:string;action:string}>}){return mailboxHttp(request,await context.params);}
