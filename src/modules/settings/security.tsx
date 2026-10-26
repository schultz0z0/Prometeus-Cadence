"use client";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useIdentity } from "@/client/workspace-provider";
import { useAction } from "@/demo/provider";
import { Button, Field, Notice, Badge } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { EyeOff, KeyRound, Monitor, ShieldCheck } from "lucide-react";
function PasswordField({label,value,onChange,autoComplete,minLength}:{label:string;value:string;onChange:(value:string)=>void;autoComplete:string;minLength?:number}) {
  const [visible,setVisible]=useState(false);
  return <Field label={label}><span className="settings-password-field"><input type={visible?"text":"password"} autoComplete={autoComplete} required minLength={minLength} maxLength={128} value={value} onChange={e=>onChange(e.target.value)}/><button type="button" aria-label={visible?"Ocultar senha":"Mostrar senha"} aria-pressed={visible} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={16}/>:<Icon name="Eye" size={16}/>}</button></span></Field>;
}
interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  userAgent?: string;
  current: boolean;
}
export function Security() {
  const identity = useIdentity(),
    run = useAction();
  const [sessions, setSessions] = useState<Session[]>([]),
    [currentPassword, setCurrent] = useState(""),
    [newPassword, setNew] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load() {
    const r = await fetch("/api/security", { cache: "no-store" });
    if (!r.ok) throw Error("Não foi possível carregar as sessões.");
    setSessions((await r.json()).sessions);
  }
  useEffect(() => {
    if (identity) void load().catch((e) => setError(e.message));
  }, [identity]);
  return (
    <div className="settings-reference security-reference">
      <h1>Segurança</h1>
      <p className="subtitle">Senha, autenticador e os dispositivos que acessam a sua conta</p>
      {!identity ? (
        <Notice>
          A segurança de conta está disponível no modo autenticado.
        </Notice>
      ) : (
        <>
          <form
            className="settings-reference-panel"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy || newPassword !== confirmation) return;
              setBusy(true);
              if (
                await run(async () => {
                  const result = await authClient.changePassword({
                    currentPassword,
                    newPassword,
                    revokeOtherSessions: true,
                  });
                  if (result.error)
                    throw Error(
                      result.error.message ??
                        "Não foi possível trocar a senha.",
                    );
                  await load();
                }, "Senha alterada. Outras sessões foram encerradas.")
              ) {
                setCurrent("");
                setNew("");
                setConfirmation("");
              }
              setBusy(false);
            }}
          >
            <header className="settings-reference-panel-head"><span className="settings-reference-symbol"><KeyRound size={20}/></span><div><h2>Senha</h2><p>Mínimo de 12 caracteres. Depois de trocar, as outras sessões são encerradas.</p></div></header>
            <div className="settings-reference-panel-body"><div className="settings-reference-grid security-password-grid">
              <PasswordField label="Senha atual" value={currentPassword} onChange={setCurrent} autoComplete="current-password"/>
              <PasswordField label="Nova senha" value={newPassword} onChange={setNew} autoComplete="new-password" minLength={12}/>
              <PasswordField label="Confirmar nova senha" value={confirmation} onChange={setConfirmation} autoComplete="new-password" minLength={12}/>
            </div>
            {confirmation&&confirmation!==newPassword&&<p role="status" className="settings-reference-footnote">As novas senhas precisam ser iguais.</p>}
            <div className="form-actions">
              <Button variant="primary" icon="Lock" disabled={busy||!currentPassword||newPassword.length<12||confirmation!==newPassword}>
                Trocar senha
              </Button>
            </div>
            </div>
          </form>
          <section className="settings-reference-panel"><header className="settings-reference-panel-head"><span className="settings-reference-symbol"><ShieldCheck size={20}/></span><div><h2>Autenticador (2FA)</h2><p>Google Authenticator, 1Password, Authy ou similar.</p></div><Badge>Indisponível</Badge></header><div className="settings-reference-panel-body row between wrap"><p>A configuração do autenticador ainda não está disponível neste ambiente.</p><Button variant="primary" disabled>Ativar autenticador</Button></div></section>
          <section className="settings-reference-panel"><header className="settings-reference-panel-head"><span className="settings-reference-symbol"><Monitor size={20}/></span><div><h2>Dispositivos conectados</h2><p>Sessões ativas da sua conta. Encerre as que você não reconhecer.</p></div></header><div className="settings-reference-panel-body">
          {error && <p role="alert">{error}</p>}
          <div className="settings-session-list">
            {sessions.map((s) => (
              <div key={s.id} className="settings-session-row row between wrap">
                <div>
                  <strong>
                    {s.current ? "Este dispositivo" : "Outro dispositivo"}
                  </strong>
                  <p
                    className="muted"
                    style={{ maxWidth: 500, overflowWrap: "anywhere" }}
                  >
                    {s.userAgent || "Navegador local"}
                  </p>
                  <small>
                    Criada em {new Date(s.createdAt).toLocaleString("pt-BR")}
                  </small>
                </div>
                <div className="row">
                  {s.current && <Badge tone="green">Atual</Badge>}
                  <Button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      await run(async () => {
                        const r = await fetch("/api/security", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ sessionId: s.id }),
                        });
                        if (!r.ok)
                          throw Error("Não foi possível encerrar esta sessão.");
                        if (s.current) location.assign("/login");
                        else await load();
                      }, "Sessão encerrada.");
                      setBusy(false);
                    }}
                  >
                    Encerrar
                  </Button>
                </div>
              </div>
            ))}
          </div>
          </div></section>
        </>
      )}
    </div>
  );
}
