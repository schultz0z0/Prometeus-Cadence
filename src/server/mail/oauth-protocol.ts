import {randomBytes,createHash} from 'node:crypto';
import {OAuth2Client} from 'google-auth-library';
export const gmailScopes=['https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.readonly'];
export function gmailOAuthSettings(env:Record<string,string|undefined>=process.env){
 const clientId=env.GMAIL_CLIENT_ID,clientSecret=env.GMAIL_CLIENT_SECRET,redirectUri=env.GMAIL_REDIRECT_URI;
 if(!clientId||!clientSecret||!redirectUri)throw Error('GMAIL_OAUTH_NOT_CONFIGURED');
 const u=new URL(redirectUri);
 if(u.username||u.password||u.hash||u.search||u.pathname!=='/api/mail-oauth/google/callback'||(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))throw Error('GMAIL_CALLBACK_INVALID');
 return {clientId,clientSecret,redirectUri};
}
export function createGmailAuthorization(settings:ReturnType<typeof gmailOAuthSettings>){
 const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
 const client=new OAuth2Client(settings.clientId,settings.clientSecret,settings.redirectUri);
 const authorizationUrl=client.generateAuthUrl({access_type:'offline',prompt:'consent',scope:gmailScopes,state,code_challenge:challenge,code_challenge_method:'S256' as any,include_granted_scopes:false});
 return {state,verifier,challenge,authorizationUrl};
}
