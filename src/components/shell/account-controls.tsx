"use client";
import Link from "next/link";
import { useState } from "react";
import { useIdentity } from "@/client/workspace-provider";
import { identityPost } from "@/modules/auth/workspace";
import { authClient } from "@/lib/auth-client";
import { useAction } from "@/demo/provider";
import { Button } from "@/components/ui/primitives";
export function AccountControls() {
  const identity = useIdentity(),
    run = useAction();
  const [busy, setBusy] = useState(false);
  if (!identity) return null;
  return (
    <div style={{ padding: "8px 14px", display: "grid", gap: 8 }}>
      <label className="field">
        <span>Workspace</span>
        <select
          aria-label="Workspace ativo"
          disabled={busy}
          value={identity.activeWorkspaceId ?? ""}
          onChange={async (e) => {
            const workspaceId = e.target.value;
            setBusy(true);
            if (await run(() => identityPost({ type: "switch", workspaceId })))
              location.assign("/dashboard");
            else setBusy(false);
          }}
        >
          {identity.workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      <div className="row between">
        <Link
          href="/onboarding/workspace"
          className="muted"
          style={{ fontSize: 11 }}
        >
          Criar workspace
        </Link>
        <Button
          icon="LogOut"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            if (
              await run(async () => {
                const result = await authClient.signOut();
                if (result.error) throw Error("Não foi possível sair.");
              })
            )
              location.assign("/login");
            else setBusy(false);
          }}
        >
          Sair
        </Button>
      </div>
    </div>
  );
}
