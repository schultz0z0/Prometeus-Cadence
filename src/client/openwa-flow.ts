import type {OpenwaConnectionView,OpenwaQrView} from '../domain/openwa.ts';
interface OpenwaPolling {
 connectionId:string;revision:number;readStatus:()=>Promise<OpenwaConnectionView>;readQr:()=>Promise<OpenwaQrView>;
 onStatus:(v:OpenwaConnectionView)=>void;onQr:(image:string|null)=>void;onError:(error:unknown)=>void;onExpired:()=>void;
 now?:()=>number;schedule?:(fn:()=>void,ms:number)=>()=>void;
}
export function startOpenwaPolling(options:OpenwaPolling):()=>void {
 const now=options.now??Date.now,start=now(),schedule=options.schedule??((fn,ms)=>{const timer=setTimeout(fn,ms);return()=>clearTimeout(timer);});
 let active=true,cancel:(()=>void)|undefined;
 async function tick(){
  if(!active)return;if(now()-start>=600000){options.onQr(null);options.onExpired();return;}
  let interval=10000;
  try{
   const view=await options.readStatus();if(!active)return;
   if(view.connection.id!==options.connectionId||view.connection.revision!==options.revision){options.onQr(null);active=false;options.onError(Error('A revisão da conexão mudou. Feche e abra novamente.'));return;}
   options.onStatus(view);
   if(view.phase==='qr_ready'){
    const qr=await options.readQr();if(!active)return;
    options.onQr(qr.connectionId===options.connectionId&&qr.revision===options.revision&&qr.phase==='qr_ready'?qr.qrCode:null);interval=3000;
   }else options.onQr(null);
  }catch(error){if(!active)return;options.onQr(null);options.onError(error);if((error as {status?:number})?.status===403||(error as {status?:number})?.status===401){active=false;return;}}
  if(active)cancel=schedule(()=>{void tick();},interval);
 }
 void tick();return()=>{active=false;cancel?.();options.onQr(null);};
}
