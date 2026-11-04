import {z} from 'zod';
// 07B.1: the SDR agent configuration (four blocks of the reference: definition, qualification script, channel, handoff rules)
// and the rules that decide whether it may be activated. The model and keys are platform-owned and never part of it.
const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const timezone=z.string().min(1).max(64).refine(tz=>{try{new Intl.DateTimeFormat('pt-BR',{timeZone:tz});return true;}catch{return false;}},'Fuso horário inválido.');
const hours=z.strictObject({timezone,weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(v=>new Set(v).size===v.length),start:time,end:time,allDay:z.boolean()})
 .refine(h=>h.allDay||h.start<h.end,'O fim do horário precisa ser depois do início.');
export const sdrDraftSchema=z.strictObject({
 name:z.string().trim().min(1).max(80),
 instructions:z.string().trim().max(4000),
 qualification:z.array(z.strictObject({question:z.string().trim().min(1).max(300),field:z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),required:z.boolean()})).max(10)
  .refine(v=>new Set(v.map(q=>q.field)).size===v.length,'Cada pergunta precisa de um campo diferente.'),
 channelIds:z.array(z.string().min(1).max(200)).max(5).refine(v=>new Set(v).size===v.length),
 hours,
 handoff:z.strictObject({memberId:z.string().max(200),rules:z.array(z.string().trim().min(1).max(200)).max(10)}),
 maxRepliesPerDay:z.number().int().min(1).max(200),
 approvalMode:z.enum(['all','bounded-auto']),
 followupEnabled:z.boolean(),
 knowledgeIds:z.array(z.string().min(1).max(200)).max(50).refine(v=>new Set(v).size===v.length),
});
export type SdrDraft=z.infer<typeof sdrDraftSchema>;
export const defaultSdrDraft=():SdrDraft=>({name:'Agente SDR',instructions:'',qualification:[],channelIds:[],
 hours:{timezone:'America/Sao_Paulo',weekdays:[1,2,3,4,5],start:'09:00',end:'18:00',allDay:false},
 handoff:{memberId:'',rules:[]},maxRepliesPerDay:20,approvalMode:'all',followupEnabled:false,knowledgeIds:[]});
export const SDR_OPENWA_DAILY_CAP=20;
export type SdrChannelFact={id:string;ready:boolean;provider:string;takenBy:string|null};
export type SdrFacts={pro:boolean;contextApproved:boolean;channels:SdrChannelFact[];handoffIsMember:boolean;knowledge:{id:string;state:string;revision?:number}[]};
export function sdrActivationAllowed(i:{contextApproved:boolean;channelReady:boolean;hasHandoff:boolean;reviewed:boolean}):boolean{
 return i.contextApproved&&i.channelReady&&i.hasHandoff&&i.reviewed;
}
/** Every reason the draft cannot be activated now; empty means it can (after review). */
export function sdrBlockers(d:SdrDraft,f:SdrFacts):string[]{
 const b:string[]=[];
 if(!f.pro)b.push('O Agente SDR faz parte do plano Pro com assinatura ativa.');
 if(!f.contextApproved)b.push('Aprove o contexto da empresa antes de ativar o agente.');
 if(!d.instructions.trim())b.push('Escreva a definição do agente: quem ele é, o que oferece e o tom.');
 const chosen=d.channelIds.map(id=>f.channels.find(c=>c.id===id));
 if(!d.channelIds.length)b.push('Escolha pelo menos um canal para o agente responder.');
 if(chosen.some(c=>!c))b.push('Um canal escolhido não existe mais neste workspace.');
 for(const c of chosen)if(c&&!c.ready)b.push('Um canal escolhido não está pronto para enviar e receber.');
 for(const c of chosen)if(c?.takenBy)b.push(`Um canal escolhido já é atendido pelo agente “${c.takenBy}”.`);
 if(chosen.some(c=>c?.provider==='openwa')&&d.maxRepliesPerDay>SDR_OPENWA_DAILY_CAP)b.push(`No WhatsApp gerenciado o limite é de ${SDR_OPENWA_DAILY_CAP} respostas por dia, somadas aos outros envios.`);
 if(!d.handoff.memberId||!f.handoffIsMember)b.push('Escolha um membro do workspace como responsável pela passagem.');
 const known=new Map(f.knowledge.map(k=>[k.id,k.state]));
 if(d.knowledgeIds.some(id=>known.get(id)!=='approved'))b.push('Aprove todos os itens de conhecimento escolhidos (ou tire os que não foram aprovados).');
 if(d.approvalMode==='bounded-auto')b.push('Responder sem aprovação só fica disponível depois do piloto supervisionado. Por enquanto, cada resposta pede o seu ok.');
 if(d.followupEnabled)b.push('O follow-up para quem não respondeu ainda não está disponível. Desligue para ativar.');
 return b;
}
