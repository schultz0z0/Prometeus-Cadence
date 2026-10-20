"use client";
import Link from "next/link";
import {useState} from "react";
import {authClient} from "@/lib/auth-client";
import {Button,Field} from "@/components/ui/primitives";
type Mode="login"|"register"|"forgot"|"reset"|"verify";
const titles:Record<Mode,string>={login:"Bem-vindo de volta",register:"Crie sua conta",forgot:"Recuperar sua senha",reset:"Defina uma nova senha",verify:"Confirme seu e-mail"};
export function AuthForm({mode,token="",google=false}:{mode:Mode;token?:string;google?:boolean}){
 const [email,setEmail]=useState("");const [name,setName]=useState("");const [password,setPassword]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [done,setDone]=useState(false);
 async function submit(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError("");
 try{
  const callbackURL=location.origin+"/onboarding/workspace";
  const result=mode==="register"?await authClient.signUp.email({email:email.trim().toLowerCase(),name,password,callbackURL}):mode==="login"?await authClient.signIn.email({email:email.trim().toLowerCase(),password,callbackURL}):mode==="forgot"?await authClient.requestPasswordReset({email:email.trim().toLowerCase(),redirectTo:location.origin+"/reset-password"}):mode==="reset"?await authClient.resetPassword({token,newPassword:password}):await authClient.sendVerificationEmail({email,callbackURL});
  if(result.error)throw Error(result.error.message??"Não foi possível concluir. Tente novamente.");
  if(mode==="login")location.assign("/dashboard");else setDone(true);
 }catch(err){setError(err instanceof Error?err.message:"Falha de conexão. Tente novamente.");}finally{setBusy(false);}}
 return <main className="auth-page"><aside className="auth-story"><Link href="/" className="auth-logo">◈ Prometeus<span>Cadence</span></Link><div><h1>Prospecção ativa<br/>que chega em<br/><em>quem decide</em></h1><p>Leads certos, cadência no e-mail, WhatsApp e LinkedIn,<br/>em um lugar só.</p><ul><li>Leads organizados e qualificados</li><li>Cadências com acompanhamento de respostas</li><li>IA com revisão e confirmação a cada etapa</li></ul></div><small>Prometeus Cadence · Seu espaço de prospecção</small></aside><section className="auth-content"><div className="auth-box"><h2>{titles[mode]}</h2><p>{mode==="login"?"Entre na sua conta para continuar":"Sua conta e seus dados em um workspace exclusivo."}</p>
 {done?<div className="auth-feedback" role="status">{mode==="reset"?"Senha redefinida. Entre com sua nova senha.":"Se o endereço puder receber esta solicitação, um link temporário estará no e-mail. Verifique sua caixa de entrada."}<p><Link href="/login">Voltar para entrar →</Link></p></div>:<>
 {(mode==="login"||mode==="register")&&<><Button disabled={!google||busy} onClick={async()=>{await authClient.signIn.social({provider:"google",callbackURL:"/onboarding/workspace"});}}>Continuar com Google</Button>{!google&&<small>Google disponível após configurar as credenciais do projeto.</small>}<div className="auth-divider">ou</div></>}
 <form onSubmit={submit}>{mode==="register"&&<Field label="Seu nome"><input autoComplete="name" required maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></Field>}{mode!=="reset"&&<Field label="E-mail"><input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></Field>}{["login","register","reset"].includes(mode)&&<Field label="Senha" help={mode==="login"?undefined:"Use pelo menos 12 caracteres."}><input type="password" required minLength={mode==="login"?1:12} maxLength={128} autoComplete={mode==="login"?"current-password":"new-password"} value={password} onChange={e=>setPassword(e.target.value)}/></Field>}{mode==="login"&&<Link className="auth-forgot" href="/forgot-password">Esqueci minha senha</Link>}{error&&<div className="auth-error" role="alert">{error}</div>}<Button variant="primary" disabled={busy||(mode==="reset"&&!token)}>{busy?"Aguarde…":mode==="login"?"Entrar →":mode==="register"?"Criar conta →":mode==="reset"?"Salvar nova senha":"Enviar link"}</Button></form>
 <p className="auth-bottom">{mode==="login"?<>Não tem conta? <Link href="/register">Criar conta</Link></>:<Link href="/login">Voltar para entrar</Link>}</p></>}
 <small className="auth-local">Ambiente local: os e-mails de teste ficam no <a href="http://127.0.0.1:8125" target="_blank" rel="noreferrer">capturador de e-mails</a>.</small></div></section></main>;
}
