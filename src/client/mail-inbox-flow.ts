import type {EmailThreadView,EmailMessageView} from '../domain/mail.ts';
export function createInboxSelection<T extends {conversation:{id:string}}>() {
 let epoch=0,disposed=false,state:{selectedId:string;thread:T|null}={selectedId:'',thread:null};const listeners=new Set<()=>void>();
 const emit=()=>listeners.forEach(listener=>listener());
 return {
  current:()=>state,subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
  select(id:string){epoch++;state={selectedId:id,thread:null};emit();return {id,epoch};},
  accept(ticket:{id:string;epoch:number},thread:T){if(disposed||ticket.epoch!==epoch||ticket.id!==state.selectedId||thread.conversation.id!==ticket.id)return false;state={selectedId:ticket.id,thread};emit();return true;},
  ticket:()=>({id:state.selectedId,epoch}),
  dispose(){disposed=true;epoch++;listeners.clear();},
 };
}
export function mergeEmailHistory(current:EmailThreadView,older:EmailThreadView):EmailThreadView{
 if(current.conversation.id!==older.conversation.id)throw Error('A página pertence a outra conversa.');
 const ids=new Set(current.messages.map(message=>message.id));return {...current,messages:[...older.messages.filter(message=>!ids.has(message.id)),...current.messages],nextCursor:older.nextCursor};
}
export function lastDisplayedMessage(thread:EmailThreadView){return thread.messages.at(-1)?.id??null;}
export function emailMessageStatus(message:EmailMessageView):string{
 if(message.state==='delivered'||message.state==='read')return 'Rastreamento indisponível';
 if(message.direction==='outbound'&&message.mail.origin==='external')return 'Observada em Enviados';
 return {received:'Recebida',pending:'Na fila',dispatching:'Tentativa em andamento',accepted:'Aceita pelo provedor',failed:'Falhou',uncertain:'Resultado incerto',cancelled:'Cancelada',blocked:'Bloqueada'}[message.state];
}
