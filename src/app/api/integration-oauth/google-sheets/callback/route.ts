import {sheetsCallbackHttp} from '../../../../../server/integrations/sheets.ts';
export const runtime='nodejs';
export async function GET(request:Request){return sheetsCallbackHttp(request);}
