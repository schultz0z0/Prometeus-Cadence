import {z} from 'zod';
export type ConnectorKind='apollo'|'google-sheets'|'funnelsflow'|'meetflow';
// Only connectors with an official, documented contract and a working adapter are available; the rest stay visible but closed.
export const connectorCatalog:{kind:ConnectorKind;available:boolean;capabilities:string[];barrier:string}[]=[
 {kind:'apollo',available:true,capabilities:['companies.search'],barrier:''},
 {kind:'google-sheets',available:false,capabilities:['sheets.append'],barrier:'Exige o escopo do Google Sheets no cliente OAuth da plataforma e a conta Google de quem conecta; previsto para o 07C.2b.'},
 {kind:'funnelsflow',available:false,capabilities:['crm.upsert'],barrier:'O FunnelsFlow não publica documentação oficial de API; sem contrato documentado o conector não é oferecido.'},
 {kind:'meetflow',available:false,capabilities:['meetings.read'],barrier:'O MeetFlow não publica documentação oficial de API; sem contrato documentado o conector não é oferecido.'},
];
export interface ConnectionView{id:string;kind:ConnectorKind;name:string;state:'ready'|'attention';capabilities:string[];revision:number;verifiedAt:string|null;lastError:string|null}
export function connectorActionAllowed(input:{action:string;capabilities:string[];connected:boolean}){
 return input.connected&&input.action.length>0&&input.capabilities.includes(input.action);
}
const available=z.enum(['apollo']);
export const credentialInputSchema=z.strictObject({kind:available,secret:z.string().trim().min(20).max(200)});
export const connectInputSchema=z.strictObject({kind:available,name:z.string().trim().min(1).max(60),credentialRef:z.uuid(),expectedRevision:z.number().int().min(0)});
