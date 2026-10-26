import { SettingsLayout } from "@/modules/settings/settings-layout";
import { notFound } from 'next/navigation';
export default async function Page({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const section=(await params).section?.join('/') ?? 'account';
  if(!['account','ai','context','email','whatsapp','dispatch-limits','apps','apps/google-sheets','apps/apollo','apps/funnelsflow','apps/meetflow','plan','notifications','seats','security','mcp','privacy','dados','webhooks'].includes(section)) notFound();
  return <SettingsLayout section={section} />;
}
