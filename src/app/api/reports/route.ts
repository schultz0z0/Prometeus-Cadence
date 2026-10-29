import {reportRequest} from '../../../server/operations/report-http';
export const runtime='nodejs';
export async function GET(request:Request){return reportRequest(request);}
