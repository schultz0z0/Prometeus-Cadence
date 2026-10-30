import "server-only";
import nodemailer from "nodemailer";
export function notificationMailAvailable(){return !!process.env.NOTIFICATION_SMTP_HOST&&!!process.env.NOTIFICATION_MAIL_FROM&&!!process.env.BETTER_AUTH_URL;}
export async function sendNotificationMail(input:{to:string;title:string;href:string}){
 if(!notificationMailAvailable()||process.env.NOTIFICATIONS_DELIVERY_ENABLED!=='true')throw Error('Notification delivery unavailable');
 const base=new URL(process.env.BETTER_AUTH_URL!);if(base.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(base.hostname))throw Error('Public HTTPS required');
 const secure=process.env.NOTIFICATION_SMTP_SECURE==='true',host=process.env.NOTIFICATION_SMTP_HOST!;
 const transport=nodemailer.createTransport({host,port:Number(process.env.NOTIFICATION_SMTP_PORT??(secure?465:587)),secure,requireTLS:!['localhost','127.0.0.1'].includes(host),auth:process.env.NOTIFICATION_SMTP_USER?{user:process.env.NOTIFICATION_SMTP_USER,pass:process.env.NOTIFICATION_SMTP_PASSWORD}:undefined,connectionTimeout:5000,socketTimeout:10000});
 try{await transport.sendMail({from:process.env.NOTIFICATION_MAIL_FROM,to:input.to,subject:input.title,text:input.title+'\n'+new URL(input.href,base).toString()});}finally{transport.close();}
}
export async function sendLocalMail(to: string, subject: string, text: string) {
  const host = process.env.SMTP_HOST ?? "127.0.0.1";
  if (!["127.0.0.1", "localhost"].includes(host))
    throw Error("External mail delivery is not enabled in this milestone.");
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 1125),
    secure: false,
    ignoreTLS: true,
    connectionTimeout: 5000,
    socketTimeout: 10000,
  });
  await transport.sendMail({
    from: "Prometeus Cadence <conta@cadence.local>",
    to,
    subject,
    text,
  });
  transport.close();
}
