import {webhookRequest} from '../../../../../server/channels/webhooks.ts';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{publicId:string}>}){return webhookRequest(request,(await context.params).publicId,'meta');}
export async function POST(request:Request,context:{params:Promise<{publicId:string}>}){return webhookRequest(request,(await context.params).publicId,'meta');}
