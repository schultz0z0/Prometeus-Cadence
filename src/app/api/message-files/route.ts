import {fileRequest} from '../../../server/messaging/content-http';
export async function GET(request:Request){return fileRequest(request);}
export async function POST(request:Request){return fileRequest(request);}
