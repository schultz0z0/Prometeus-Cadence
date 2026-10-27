import {peopleRequest} from '../../../../server/research/people-http';
export async function GET(request:Request){return peopleRequest(request);}
