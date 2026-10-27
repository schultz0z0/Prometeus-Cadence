import {fileRequest} from '../../../../server/messaging/content-http';
export async function GET(request:Request,ctx:{params:Promise<{id:string}>}){return fileRequest(request,(await ctx.params).id);}
