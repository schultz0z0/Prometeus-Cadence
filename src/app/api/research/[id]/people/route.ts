import {peopleRequest} from '../../../../../server/research/people-http';
export async function GET(request:Request,ctx:{params:Promise<{id:string}>}){return peopleRequest(request,(await ctx.params).id);}
export async function POST(request:Request,ctx:{params:Promise<{id:string}>}){return peopleRequest(request,(await ctx.params).id);}
