import {randomUUID} from 'node:crypto';
import {whatsappUser,testAdmin} from './whatsapp-helpers.ts';
export {whatsappUser,testAdmin};
export const openwaInput=()=>({requestId:randomUUID(),name:'QA own WhatsApp'});
export async function openwaFixture(){
 const u=await whatsappUser();const {createOpenwaRecord}=await import('../../src/server/channels/openwa/repository.ts');
 const input=openwaInput(),view=await createOpenwaRecord(u.p,input);
 return {u,input,view,id:view.connection.id};
}
