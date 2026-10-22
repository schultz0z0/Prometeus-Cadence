import {whatsappBlocker} from './whatsapp-copy.ts';
const copy:Record<string,string>={
 EMAIL_SYNC_REQUIRED:'Sincronize a caixa: campanhas exigem uma leitura completa nos últimos cinco minutos.',
 EMAIL_AUTHORIZATION_REQUIRED:'Registre a autorização do destinatário para esta campanha de e-mail.',
 MAILBOX_BASELINE_REQUIRED:'Verifique envio e leitura, defina limites e faça a primeira sincronização antes de comprovar a caixa.',
 EMAIL_PUBLIC_URL_REQUIRED:'Configure o endereço HTTPS público do app para incluir o descadastro.',
 EMAIL_LIMIT_REQUIRED:'Defina o limite diário de e-mail do workspace.',
 MAIL_SIGNATURE_CHANGED:'A assinatura mudou. Atualize o conteúdo e prepare uma nova revisão.',
 EMAIL_THREAD_REVIEW_REQUIRED:'Esta conversa precisa de revisão antes de receber uma resposta.',
 EMAIL_SUBJECT_THREAD_MISMATCH:'O assunto precisa corresponder a esta conversa.',
 EMAIL_REPLY_REFERENCE_REQUIRED:'Falta uma referência confiável para responder nesta conversa.',
 VALID_EMAIL_REQUIRED:'O destinatário precisa de um endereço de e-mail válido.',
 EXPLICIT_LIMITS_REQUIRED:'Defina os limites gerais, do canal e da caixa.',
 EMAIL_BOUNCE_REVIEW_REQUIRED:'A caixa foi pausada após devoluções. Revise os motivos antes de retomar.',
 EMAIL_SYNC_REVIEW_REQUIRED:'Há uma lacuna no histórico. Revise a caixa antes de retomar.',
};
export function mailBlocker(value:string){const code=Object.keys(copy).find(k=>value.includes(k));return code?copy[code]:whatsappBlocker(value);}
export const mailboxStateLabel={pending:'Configuração pendente',authorization_required:'Conectar novamente',verifying:'Verificação em andamento',ready:'Pronta',attention:'Requer atenção',disconnected:'Desconectada'};
