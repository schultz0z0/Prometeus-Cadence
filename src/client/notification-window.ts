import type{NotificationItem}from'../domain/notifications.ts';
/** Reconcile all loaded pages with a fresh head; losing authority clears the window. */
export function mergeNotificationWindow(cached:NotificationItem[],fresh:NotificationItem[],allowed:boolean):NotificationItem[]{
 if(!allowed)return[];
 const byId=new Map(cached.map(item=>[item.id,item]));for(const item of fresh)byId.set(item.id,item);
 return[...byId.values()].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||b.id.localeCompare(a.id));
}
