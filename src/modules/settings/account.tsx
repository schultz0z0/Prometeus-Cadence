"use client";
import { useState } from "react";
import { useDemo, useRepository, useAction } from "@/demo/provider";
import { useIdentity, useCapabilities } from "@/client/workspace-provider";
import { authClient } from "@/lib/auth-client";
import { identityPost } from "@/modules/auth/workspace";
import { Button, Field, Toggle, Notice } from "@/components/ui/primitives";
export function Account() {
  const s = useDemo(),
    repo = useRepository(),
    run = useAction(),
    identity = useIdentity(),
    capabilities = useCapabilities();
  const [p, setP] = useState({ ...s.preferences }),
    [name, setName] = useState(s.preferences.accountName),
    [busy, setBusy] = useState(false);
  const active = identity?.workspaces.find(
      (w) => w.id === identity.activeWorkspaceId,
    ),
    [workspaceName, setWorkspaceName] = useState(active?.name ?? "");
  const admin = !identity || capabilities?.includes("workspace.settings");
  return (
    <>
      <h1>Conta</h1>
      <p className="subtitle">
        Seu perfil pessoal e as preferências de prospecção do workspace.
      </p>
      <form
        className="settings-section"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          const ok = await run(async () => {
            if (identity) {
              const result = await authClient.updateUser({ name });
              if (result.error)
                throw Error(
                  result.error.message ?? "Não foi possível salvar o perfil.",
                );
            } else await repo.updatePreferences({ accountName: name });
          }, "Perfil salvo.");
          setBusy(false);
          if (ok && identity) location.reload();
        }}
      >
        <h2>Perfil pessoal</h2>
        <div className="profile-avatar-row">
          <span className="large-avatar">{name.slice(0, 1)}</span>
          <div>
            <strong>{name}</strong>
            <small>{identity?.user.email ?? "Demonstração local"}</small>
          </div>
        </div>
        <div className="field-grid">
          <Field label="Nome">
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="E-mail de login">
            <input
              disabled
              value={identity?.user.email ?? "Conta demonstrativa"}
            />
          </Field>
        </div>
        <div className="form-actions">
          <Button variant="primary" disabled={busy}>
            Salvar perfil
          </Button>
        </div>
      </form>
      {identity && (
        <form
          className="settings-section"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            if (
              await run(
                () => identityPost({ type: "rename", name: workspaceName }),
                "Nome do workspace salvo.",
              )
            )
              location.reload();
            setBusy(false);
          }}
        >
          <h2>Workspace</h2>
          <Field label="Nome do workspace">
            <input
              required
              minLength={2}
              maxLength={100}
              disabled={!admin}
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
            />
          </Field>
          <div className="form-actions">
            <Button variant="primary" disabled={!admin || busy}>
              Salvar workspace
            </Button>
          </div>
        </form>
      )}
      <form
        className="settings-section"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          await run(() => repo.updatePreferences(p), "Preferências salvas.");
          setBusy(false);
        }}
      >
        <h2>Preferências</h2>
        {!admin && (
          <Notice>
            Empresa, fuso e e-mail de cobrança são administrados pelo
            proprietário ou administrador.
          </Notice>
        )}
        <div className="field-grid">
          <Field label="Empresa">
            <input
              disabled={!admin}
              maxLength={100}
              value={p.company}
              onChange={(e) => setP({ ...p, company: e.target.value })}
            />
          </Field>
          <Field label="Fuso horário">
            <select
              disabled={!admin}
              value={p.timezone}
              onChange={(e) => setP({ ...p, timezone: e.target.value })}
            >
              <option value="America/Sao_Paulo">Brasília (UTC−3)</option>
              <option value="America/Manaus">Manaus (UTC−4)</option>
              <option value="America/Rio_Branco">Rio Branco (UTC−5)</option>
              <option value="Europe/Lisbon">Lisboa</option>
              <option value="America/New_York">New York</option>
            </select>
          </Field>
          <Field label="E-mail de cobrança">
            <input
              type="email"
              disabled={!admin}
              value={p.billingEmail}
              onChange={(e) => setP({ ...p, billingEmail: e.target.value })}
            />
          </Field>
        </div>
        <div className="settings-divider" />
        <h2>Relatórios por e-mail</h2>
        <p className="settings-desc">
          Preferências pessoais. O envio depende da futura integração de e-mail.
        </p>
        <Toggle
          label="Resumo diário"
          checked={p.dailyReport}
          onChange={(v) => setP({ ...p, dailyReport: v })}
        />
        <Toggle
          label="Resumo semanal"
          checked={p.weeklyReport}
          onChange={(v) => setP({ ...p, weeklyReport: v })}
        />
        <Toggle
          label="Resumo mensal"
          checked={p.monthlyReport}
          onChange={(v) => setP({ ...p, monthlyReport: v })}
        />
        <div className="form-actions">
          <Button variant="primary" disabled={busy}>
            Salvar preferências
          </Button>
        </div>
      </form>
    </>
  );
}
