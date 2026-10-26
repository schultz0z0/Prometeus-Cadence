"use client";
import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button, Field } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { RegistrationChoice, type RegistrationIntent } from "./registration-choice";
import {RegistrationFields} from './registration-fields';
import {LEGAL_VERSION} from '@/domain/legal-documents';
import {entryDestination,signupDestination,validateRegistration} from '@/domain/registration';
type Mode = "login" | "register" | "forgot" | "reset" | "verify";
const titles: Record<Mode, string> = {
  login: "Bem-vindo de volta",
  register: "Crie sua conta",
  forgot: "Esqueceu sua senha?",
  reset: "Defina uma nova senha",
  verify: "Confirme seu e-mail",
};
export function AuthForm({
  mode,
  token = "",
  google = false,
  next = '/dashboard',
  initialError = '',
  localMail = false,
}: {
  mode: Mode;
  token?: string;
  google?: boolean;
  next?: string;
  initialError?: string;
  localMail?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [done, setDone] = useState(false);
  const [showPassword,setShowPassword] = useState(false);
  const [registerDetails,setRegisterDetails]=useState(next.startsWith('/accept-invitation'));
  const [intent,setIntent]=useState<RegistrationIntent>({plan:'essential',mode:'trial'});
  const [confirmation,setConfirmation]=useState('');
  const [showConfirmation,setShowConfirmation]=useState(false);
  const [phone,setPhone]=useState('');
  const [accepted,setAccepted]=useState(false);
  const [resendAt,setResendAt]=useState(0);
  const registration={phone,accepted,termsVersion:LEGAL_VERSION,privacyVersion:LEGAL_VERSION};
  const destination=entryDestination(next);
  const onboardingPath=destination.startsWith('/accept-invitation')?destination:mode==='register'?signupDestination(intent.plan,intent.mode):destination;
  const verificationPath='/onboarding/entry?next='+encodeURIComponent(onboardingPath);
  const loginPath='/login?next='+encodeURIComponent(onboardingPath);
  let validRegistration=false;try{validateRegistration(registration);validRegistration=true;}catch{}
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if(mode==='register'&&password!==confirmation){setError('As senhas precisam ser iguais.');return;}
    setBusy(true);
    setError("");
    try {
      const callbackURL = location.origin + verificationPath;
      const signup={email:email.trim().toLowerCase(),name,password,callbackURL,registration};
      const result =
        mode === "register"
          ? await authClient.signUp.email(signup)
          : mode === "login"
            ? await authClient.signIn.email({
                email: email.trim().toLowerCase(),
                password,
                callbackURL,
              })
            : mode === "forgot"
              ? await authClient.requestPasswordReset({
                  email: email.trim().toLowerCase(),
                  redirectTo: location.origin + "/reset-password?next="+encodeURIComponent(destination),
                })
              : mode === "reset"
                ? await authClient.resetPassword({
                    token,
                    newPassword: password,
                  })
                : await authClient.sendVerificationEmail({
                    email,
                    callbackURL,
                  });
      if (result.error)
        throw Error(
          result.error.code === 'EMAIL_NOT_VERIFIED' ? 'Confirme seu e-mail antes de entrar. Você pode solicitar outro link abaixo.' : mode==='reset' ? 'Este link é inválido, expirou ou já foi utilizado. Solicite um novo link.' : mode==='login' ? 'Não foi possível entrar. Confira seu e-mail e senha e tente novamente.' : result.error.message ?? "Não foi possível concluir. Tente novamente.",
        );
      if (mode === "login") location.assign(onboardingPath);
      else setDone(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Falha de conexão. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={`auth-page auth-${mode}`}>
      <aside className="auth-story">
        <Link href="/" className="auth-logo">
          ◈ Prometeus<span>Cadence</span>
        </Link>
        <div>
          {mode==="register"?<><h2>Comece a<br/>prospectar<br/>agora</h2><p>Crie sua conta, verifique seu e-mail e comece a usar em minutos.</p><ol className="registration-story-steps">{["Plano","Seus dados","Verificar o e-mail"].map((label,i)=><li key={label} className={i===(done?2:registerDetails?1:0)?"active":i<(done?2:registerDetails?1:0)?'complete':''}><span>{i<(done?2:registerDetails?1:0)?'✓':i+1}</span>{label}</li>)}</ol></>:<><h2>
            Prospecção ativa
            <br />
            que chega em
            <br />
            <em>quem decide</em>
          </h2>
          <p>
            Leads certos, cadência no e-mail, WhatsApp e LinkedIn,
            <br />
            em um lugar só.
          </p>
          <ul>
            <li><Icon name="Users" size={17}/>Leads organizados e qualificados</li>
            <li><Icon name="ChartNoAxesCombined" size={17}/>Cadências com acompanhamento de respostas</li>
            <li><Icon name="Sparkles" size={17}/>IA com revisão e confirmação a cada etapa</li>
          </ul></>}
        </div>
        <small className="auth-story-footer"><span>© 2026 Prometeus Cadence</span><span><Link href="/terms">Termos</Link><Link href="/privacy">Privacidade</Link></span></small>
      </aside>
      <section className="auth-content">
        <div className="auth-box">
          {mode==='register'&&<div className="registration-progress" aria-label="Etapas do cadastro"><span className={done||registerDetails?'complete':'active'}>{done||registerDetails?'✓':'1'}</span><i/><span className={done?'complete':registerDetails?'active':''}>{done?'✓':'2'}</span><i/><span className={done?'active':''}>3</span></div>}
          <h1>{mode==='register'?(registerDetails?'Criar sua conta':'Escolha como começar'):titles[mode]}</h1>
          <p>
            {mode === "login"
              ? "Entre na sua conta para continuar"
              : mode==='forgot'?'Sem problema! Informe seu e-mail para receber o link de redefinição.':mode==='register'&&!registerDetails?'Dá pra trocar de plano depois, a qualquer momento.':mode==='register'?'Preencha seus dados e confirme seu e-mail. Nenhuma cobrança é feita ao criar a conta.':"Sua conta e seus dados em um workspace exclusivo."}
          </p>
          {mode==='register'&&!registerDetails?<RegistrationChoice value={intent} onChange={setIntent} onContinue={()=>setRegisterDetails(true)}/>:done ? (
            <div className="auth-feedback" role="status">
              {mode === "reset"
                ? "Senha redefinida. Entre com sua nova senha."
                : "Se o endereço puder receber esta solicitação, um link temporário estará no e-mail. Verifique sua caixa de entrada."}
              <p>
                <Link href={loginPath}>Voltar para entrar →</Link>
              </p>
              {mode!=='reset'&&<Button disabled={busy} onClick={async()=>{if(Date.now()<resendAt){setError('Aguarde um minuto antes de solicitar outro link.');return;}setBusy(true);setError('');try{const result=mode==='forgot'?await authClient.requestPasswordReset({email,redirectTo:location.origin+'/reset-password?next='+encodeURIComponent(destination)}):await authClient.sendVerificationEmail({email,callbackURL:location.origin+verificationPath});if(result.error)throw Error('Não foi possível reenviar. Tente novamente em instantes.');setResendAt(Date.now()+60000);}catch(e){setError(e instanceof Error?e.message:'Falha de conexão.');}finally{setBusy(false);}}}>{busy?'Aguarde…':'Reenviar link'}</Button>}
              {error&&<p className="auth-error" role="alert">{error}</p>}
            </div>
          ) : (
            <>
              {mode==='register'&&<><div className="registration-selected"><span>{destination.startsWith('/accept-invitation')?'Criar conta para aceitar convite':<>{intent.plan==='pro'?'Pro':'Essential'} · {intent.mode==='trial'?'Teste grátis de 7 dias':'Assinatura após revisão'}</>}</span>{!destination.startsWith('/accept-invitation')&&<button type="button" onClick={()=>setRegisterDetails(false)}>trocar</button>}</div><p className="registration-no-charge">{intent.mode==='trial'?'7 dias grátis, sem cartão e sem cobrança automática.':'Nenhuma cobrança sem revisão e confirmação.'}</p></>}
              {(mode === "login" || mode === "register") && (
                <>
                  <Button
                    disabled={!google || busy}
                    title={!google?'Login com Google indisponível neste ambiente.':undefined}
                    onClick={async () => {
                      setBusy(true);setError('');try{const result=await authClient.signIn.social({
                        provider: "google",
                        callbackURL: '/onboarding/profile?next='+encodeURIComponent(onboardingPath),
                      });if(result.error)throw Error('Não foi possível conectar ao Google. Tente novamente.');}catch(e){setError(e instanceof Error?e.message:'Falha de conexão.');setBusy(false);}
                    }}
                  >
                    <span className="google-auth-mark" aria-hidden="true">G</span>Continuar com Google
                  </Button>
                  <div className="auth-divider">ou com e-mail</div>
                </>
              )}
              <form onSubmit={submit}>
                {mode === "register" && (
                  <Field label="Nome">
                    <input
                      autoComplete="name"
                      required
                      maxLength={100}
                      placeholder="Qual é o seu nome?"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>
                )}
                {mode !== "reset" && (
                  <Field label="E-mail">
                    <span className="auth-email-input"><Icon name="Mail" size={16}/><input
                      type="email"
                      placeholder="seu@email.com"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    /></span>
                  </Field>
                )}
                {mode==='register'&&<RegistrationFields part="phone" phone={phone} onPhone={setPhone} accepted={accepted} onAccepted={setAccepted}/>}
                <div className={mode==='register'?'registration-passwords':'auth-passwords'}>
                {["login", "register", "reset"].includes(mode) && (
                  <Field
                    label="Senha"
                    help={
                      mode === "login"||mode==='register'
                        ? undefined
                        : "Use pelo menos 12 caracteres."
                    }
                  >
                    <span className="auth-password-input"><Icon name="Lock" size={16}/><input
                      type={showPassword?'text':'password'}
                      placeholder={mode==='register'?'Mínimo 12 caracteres':'••••••••'}
                      required
                      minLength={mode === "login" ? 1 : 12}
                      maxLength={128}
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    /><button type="button" aria-label={showPassword?'Ocultar senha':'Mostrar senha'} onClick={()=>setShowPassword(!showPassword)}><Icon name={showPassword?'EyeOff':'Eye'} size={16}/></button></span>
                  </Field>
                )}
                {mode==='register'&&<Field label="Confirmar senha"><span className="auth-password-input"><Icon name="Lock" size={16}/><input type={showConfirmation?'text':'password'} required minLength={12} maxLength={128} autoComplete="new-password" value={confirmation} onChange={e=>setConfirmation(e.target.value)}/><button type="button" aria-label={showConfirmation?'Ocultar confirmação da senha':'Mostrar confirmação da senha'} onClick={()=>setShowConfirmation(!showConfirmation)}><Icon name={showConfirmation?'EyeOff':'Eye'} size={16}/></button></span></Field>}
                </div>
                {mode==='register'&&<RegistrationFields part="accept" phone={phone} onPhone={setPhone} accepted={accepted} onAccepted={setAccepted}/>}
                {mode === "login" && (
                  <Link className="auth-forgot" href={'/forgot-password?next='+encodeURIComponent(destination)}>
                    Esqueci minha senha
                  </Link>
                )}
                {error && (
                  <div className="auth-error" role="alert">
                    {error}
                  </div>
                )}
                {mode==='login'&&error&&<Link href={'/verify-email?next='+encodeURIComponent(onboardingPath)}>Solicitar novo link de verificação</Link>}
                {mode==='reset'&&(!token||error)&&<Link href={'/forgot-password?next='+encodeURIComponent(destination)}>Solicitar novo link de redefinição</Link>}
                <Button
                  variant="primary"
                  disabled={busy || (mode === 'register'&&(!validRegistration||!name.trim()||password.length<12||password!==confirmation)) || (mode === "reset" && !token) || (!email.trim() && mode !== 'reset') || (['login','register','reset'].includes(mode)&&!password)}
                >
                  {busy
                    ? "Aguarde…"
                    : mode === "login"
                      ? "Entrar →"
                      : mode === "register"
                        ? "Criar conta e verificar e-mail"
                        : mode === "reset"
                          ? "Salvar nova senha"
                          : "Enviar link"}
                </Button>
              </form>
              <p className="auth-bottom">
                {mode === "login" ? (
                  <>
                    Não tem conta? <Link href={'/register?next='+encodeURIComponent(destination)}>Criar conta</Link>
                  </>
                ) : (
                  <>{mode==='register'?'Já tem conta? ':''}<Link href={loginPath}>{mode==='register'?'Fazer login':'Voltar para entrar'}</Link></>
                )}
              </p>
            </>
          )}
          {localMail&&<small className="auth-local">
            Ambiente local: os e-mails de teste ficam no{" "}
            <a href="http://127.0.0.1:8125" target="_blank" rel="noreferrer">
              capturador de e-mails
            </a>
            .
          </small>}
        </div>
      </section>
    </main>
  );
}
