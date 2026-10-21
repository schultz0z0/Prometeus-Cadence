import type {PreparedSend,Provider,SendOutcome,SenderView,TemplateView} from '../../../domain/whatsapp.ts';
export interface ProviderConfig {provider:Provider;connectionId:string;revision:number;identifiers:Record<string,string>;credentials:Record<string,string>;sender:SenderView|null;templates:TemplateView[]}
export interface VerifiedSender {externalId:string;address:string|null;identityScope:string;capabilities:Record<string,unknown>}
export interface VerifiedAssets {externalAccountId:string;senders:VerifiedSender[];tokenExpiresAt:string|null}
export interface ProviderAdapter {
 verifyAssets(config:ProviderConfig):Promise<VerifiedAssets>;
 listTemplates(config:ProviderConfig):Promise<TemplateView[]>;
 sendOnce(config:ProviderConfig,send:PreparedSend,callbackUrl:string):Promise<SendOutcome>;
 lookupMessage(config:ProviderConfig,remoteId:string):Promise<SendOutcome|null>;
}
export class ChannelProviderError extends Error {code:string;constructor(code:string){super('Não foi possível validar o recurso no provedor.');this.code=code;}}
