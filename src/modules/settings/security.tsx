"use client";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useIdentity } from "@/client/workspace-provider";
import { useAction } from "@/demo/provider";
import { Button, Field, Notice, Badge } from "@/components/ui/primitives";
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
    <>
      <h1>Segurança</h1>
      <p className="subtitle">Senha e dispositivos da sua conta.</p>
      {!identity ? (
        <Notice>
          A segurança de conta está disponível no modo autenticado.
        </Notice>
      ) : (
        <>
          <form
            className="settings-section"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
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
              }
              setBusy(false);
            }}
          >
            <h2>Trocar senha</h2>
            <Field label="Senha atual">
              <input
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </Field>
            <Field label="Nova senha" help="Pelo menos 12 caracteres.">
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={newPassword}
                onChange={(e) => setNew(e.target.value)}
              />
            </Field>
            <div className="form-actions">
              <Button variant="primary" disabled={busy}>
                Alterar senha
              </Button>
            </div>
          </form>
          <h2>Sessões ativas</h2>
          {error && <p role="alert">{error}</p>}
          <div className="panel">
            {sessions.map((s) => (
              <div key={s.id} className="panel-pad row between">
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
        </>
      )}
    </>
  );
}
