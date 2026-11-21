import { Qualifier } from "@/modules/prospecting/qualifier";
// 21/11/2026: ?lista=<id> opens the qualifier with that list chosen (from the end-user generation screen).
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const lista=(await searchParams).lista;
  return <Qualifier initialList={typeof lista==="string"?lista:undefined} />;
}
