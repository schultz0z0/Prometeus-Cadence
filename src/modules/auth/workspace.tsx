"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Field } from "@/components/ui/primitives";
export async function identityPost(body: unknown) {
  const response = await fetch("/api/identity", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.message ?? "Não foi possível concluir.");
  return result;
}
export function WorkspaceSetup({ invitationId }: { invitationId?: string }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>(
    [],
  );
  useEffect(() => {
    fetch("/api/identity", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) location.assign("/login");
        if (r.ok) setWorkspaces((await r.json()).workspaces);
      })
      .catch(() => setError("Não foi possível carregar sua conta."));
  }, []);
  async function act(body: unknown) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await identityPost(body);
      location.assign("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha de conexão.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-content" style={{ minHeight: "100svh" }}>
      <div className="auth-box">
        <Link href="/">◈ Prometeus Cadence</Link>
        <h2>{invitationId ? "Aceitar convite" : "Seu workspace"}</h2>
        <p>
          {invitationId
            ? "Confirme o acesso com o e-mail que recebeu o convite."
            : "Organize sua prospecção em um espaço exclusivo. Você começa com uma base vazia."}
        </p>
        {error && (
          <p role="alert" className="auth-error">
            {error}
          </p>
        )}
        {invitationId ? (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => act({ type: "accept", invitationId })}
          >
            {busy ? "Aguarde…" : "Aceitar convite"}
          </Button>
        ) : (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act({ type: "create", requestId, name });
              }}
            >
              <Field label="Nome do workspace">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  minLength={2}
                  maxLength={100}
                  required
                  placeholder="Sua empresa"
                />
              </Field>
              <Button variant="primary" disabled={busy}>
                {busy ? "Criando…" : "Criar workspace →"}
              </Button>
            </form>
            {workspaces.length > 0 && (
              <>
                <h3>Seus workspaces</h3>
                {workspaces.map((w) => (
                  <Button
                    key={w.id}
                    disabled={busy}
                    onClick={() => act({ type: "switch", workspaceId: w.id })}
                  >
                    {w.name} →
                  </Button>
                ))}
              </>
            )}
          </>
        )}
        <p>
          <Link href="/login">Entrar com outra conta</Link>
        </p>
      </div>
    </main>
  );
}
