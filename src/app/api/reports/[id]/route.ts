import {reportRequest} from '../../../../server/operations/report-http';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return reportRequest(request,(await context.params).id);}
