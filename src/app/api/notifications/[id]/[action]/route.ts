import{notificationRequest}from'../../../../../server/notifications/http';
export async function POST(request:Request,context:{params:Promise<{id:string;action:string}>}){const{id,action}=await context.params;return notificationRequest(request,id,action);}
