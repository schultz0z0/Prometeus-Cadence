import {contentRequest} from '../../../server/messaging/content-http';
export async function GET(request:Request){return contentRequest(request);}
export async function POST(request:Request){return contentRequest(request);}
