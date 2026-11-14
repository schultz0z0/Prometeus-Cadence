import type {MessageView} from '../domain/whatsapp.ts';
type Thread={messages:MessageView[];nextCursor:string|null};
// An older page goes on top; the cursor moves back. Messages already shown win.
export function prependOlder<T extends Thread>(old:T,page:Thread):T{return {...old,messages:[...page.messages.filter(m=>!old.messages.some(x=>x.id===m.id)),...old.messages],nextCursor:page.nextCursor};}
// A live poll brings the newest page: fresh states replace old copies, older pages already loaded stay, and so does the cursor.
export function mergeLatest<T extends Thread>(old:T,fresh:T):T{return {...fresh,messages:[...old.messages.filter(m=>!fresh.messages.some(n=>n.id===m.id)),...fresh.messages],nextCursor:old.nextCursor};}
// Where the history scroll goes after a render: an older page grows the top, so the view moves down by what was added;
// new messages at the bottom are followed only when the person was already there.
export function nextScrollTop({scrollHeight,scrollTop,prevHeight,prepended,stick}:{scrollHeight:number;scrollTop:number;prevHeight:number;prepended:boolean;stick:boolean}):number{
 if(prepended)return scrollTop+scrollHeight-prevHeight;
 return stick?scrollHeight:scrollTop;
}
export const nearBottom=(el:{scrollHeight:number;scrollTop:number;clientHeight:number})=>el.scrollHeight-el.scrollTop-el.clientHeight<48;
export function dayLabel(iso:string,now=new Date()):string{
 const d=new Date(iso),day=(x:Date)=>new Date(x.getFullYear(),x.getMonth(),x.getDate()).getTime(),diff=Math.round((day(now)-day(d))/86400000);
 if(diff===0)return 'Hoje';if(diff===1)return 'Ontem';
 return d.toLocaleDateString('pt-BR',diff<7&&diff>0?{weekday:'long'}:{day:'2-digit',month:'2-digit',year:'numeric'});
}
