import { Inbox } from "@/modules/messages/inbox";
export default async function Page({searchParams}:{searchParams:Promise<{channel?:string|string[]}>}) {
  const channel=(await searchParams).channel;
  return <Inbox channel={typeof channel==='string'&&channel.toLowerCase()==='whatsapp'?'WHATSAPP':'EMAIL'} />;
}
