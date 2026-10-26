"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Field } from "@/components/ui/primitives";
import {authClient} from '@/lib/auth-client';
import {entryDestination,signupDestination} from '@/domain/registration';
export async function identityPost(
  body: unknown,
  expectedWorkspaceId?: string,
) {
  const response = await fetch("/api/identity", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(expectedWorkspaceId
        ? { "x-cadence-workspace": expectedWorkspaceId }
        : {}),
    },
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
  const [loading,setLoading]=useState(true);
  useEffect(() => {
    fetch("/api/identity", { cache: "no-store" })
      .then(async (r) => {
        const next=invitationId?'/accept-invitation?id='+encodeURIComponent(invitationId):entryDestination(location.pathname+location.search);
        if (r.status === 401) {location.assign('/login?next='+encodeURIComponent(next));return;}
        const data=await r.json();
        if (!r.ok) throw Error(data.message??'Não foi possível carregar sua conta.');
        if(data.registrationRequired){location.assign('/onboarding/profile?next='+encodeURIComponent(next));return;}
        setWorkspaces(data.workspaces);
      })
      .catch(e => setError(e instanceof Error?e.message:"Não foi possível carregar sua conta."))
      .finally(()=>setLoading(false));
  }, [invitationId]);
  async function act(body: unknown) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await identityPost(body);
      const query=new URLSearchParams(location.search),plan=query.get('signupPlan'),mode=query.get('signupMode');
      const intended=signupDestination(plan,mode);
      location.assign(!invitationId&&intended.includes('?')?'/settings/plan'+intended.slice(intended.indexOf('?')):'/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha de conexão.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-content entry-workspace" style={{ minHeight: "100svh" }}>
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
        {loading&&<p role="status">Carregando sua conta…</p>}
        {invitationId ? (
          <Button
            variant="primary"
            disabled={busy||loading}
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
              <Button variant="primary" disabled={busy||loading}>
                {busy ? "Criando…" : "Criar workspace →"}
              </Button>
            </form>
            {workspaces.length > 0 && (
              <>
                <h3>Seus workspaces</h3>
                {workspaces.map((w) => (
                  <Button
                    key={w.id}
                    disabled={busy||loading}
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
          <button type="button" disabled={busy} onClick={async()=>{setBusy(true);try{const result=await authClient.signOut();if(result.error)throw Error('Não foi possível encerrar a sessão.');location.assign('/login'+(invitationId?'?next='+encodeURIComponent('/accept-invitation?id='+encodeURIComponent(invitationId)):''));}catch(e){setError(e instanceof Error?e.message:'Falha de conexão.');setBusy(false);}}}>Entrar com outra conta</button>
        </p>
      </div>
    </main>
  );
}
