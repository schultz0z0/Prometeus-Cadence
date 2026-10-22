import {mailUnsubscribeHttp} from '../../../../../server/mail/http.ts';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{token:string}>}){return mailUnsubscribeHttp(request,(await context.params).token,'one-click');}
