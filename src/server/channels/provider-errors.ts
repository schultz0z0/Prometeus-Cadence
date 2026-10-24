import {AppError} from '../errors.ts';
import {ChannelProviderError} from './providers/contracts.ts';
const messages:Record<string,string>={
 META_TOKEN_SCOPE_INVALID:'O token não pertence a este aplicativo ou não tem as permissões de WhatsApp necessárias. Confira o App ID e gere um token com acesso à conta selecionada.',
 META_TOKEN_EXPIRED:'O token da Meta expirou. Gere outro e atualize as credenciais da conexão.',
 META_WABA_MISMATCH:'A conta WhatsApp retornada pela Meta não corresponde ao WABA ID informado.',
 META_SENDER_UNAVAILABLE:'O número informado não está conectado à API da Meta ou não pertence à conta WhatsApp selecionada. Confira o Phone Number ID e o estado do número na Meta.',
 META_SENDER_INVALID:'A Meta não retornou um telefone válido para o remetente selecionado.',
 META_CONFIG_INVALID:'Revise App ID, WABA ID, Phone Number ID, access token e App secret.',
 API_VERIFICATION_FAILED:'O provedor recusou a consulta de verificação. Confira as credenciais, as permissões e o acesso à conta selecionada.',
};
export function channelProviderAppError(error:ChannelProviderError){
 const message=messages[error.code];return new AppError(message?422:502,message??'Não foi possível validar o recurso no provedor. Tente novamente ou confira a conexão.',message?error.code:'CHANNEL_PROVIDER_FAILED');
}
