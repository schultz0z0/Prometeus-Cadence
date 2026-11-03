import {calendarCallbackHttp} from '../../../../../server/integrations/calendar.ts';
export const runtime='nodejs';
export async function GET(request:Request){return calendarCallbackHttp(request);}
