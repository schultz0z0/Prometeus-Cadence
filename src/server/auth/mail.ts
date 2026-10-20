import "server-only";
import nodemailer from "nodemailer";
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
