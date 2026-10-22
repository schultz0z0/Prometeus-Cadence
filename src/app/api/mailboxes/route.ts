import {mailboxHttp} from '../../../server/mail/http.ts';
export const runtime='nodejs';
export const GET=(request:Request)=>mailboxHttp(request,{});
export const POST=(request:Request)=>mailboxHttp(request,{});
