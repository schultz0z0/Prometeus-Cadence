import { SettingsLayout } from "@/modules/settings/settings-layout";
export default async function Page({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  return <SettingsLayout section={(await params).section?.[0]} />;
}
