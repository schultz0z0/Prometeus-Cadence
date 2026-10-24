// Historical URL retained as an explicit retirement response; no SDK, credential or body read.
export function POST(){return new Response(null,{status:410,headers:{'cache-control':'no-store'}});}
export const GET=POST;
