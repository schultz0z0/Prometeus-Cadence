"use client";
import Link from 'next/link';
import { useState } from 'react';
import { useIdentity } from '@/client/workspace-provider';
import { identityPost } from '@/modules/auth/workspace';
import { authClient } from '@/lib/auth-client';
import { useAction } from '@/demo/provider';
import { Button } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icon';
export function AccountControls() {
    const identity = useIdentity(), run = useAction(), [busy, setBusy] = useState(false);
    if (!identity)
        return null;
    const workspace = identity.workspaces.find(w => w.id === identity.activeWorkspaceId);
    return <details className="account-menu"><summary><span className="avatar">{identity.user.name[0] ?? 'P'}</span><span className="account-menu-identity"><strong>{identity.user.name}</strong><small>{identity.user.email}</small></span><Icon name="ChevronsUpDown" size={15}/></summary><div className="account-menu-popover"><p>{workspace?.name ?? 'Seu workspace'}</p><label className="field"><span>Workspace</span><select aria-label="Workspace ativo" disabled={busy} value={identity.activeWorkspaceId ?? ''} onChange={async (e) => { const workspaceId = e.target.value; setBusy(true); if (await run(() => identityPost({ type: 'switch', workspaceId })))
        location.assign('/dashboard');
    else
        setBusy(false); }}>{identity.workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label><Link className="help-link" href="/settings/account"><Icon name="User" size={15}/>Minha conta</Link><Link className="help-link" href="/onboarding/workspace"><Icon name="Plus" size={15}/>Criar workspace</Link><Button icon="LogOut" disabled={busy} onClick={async () => { setBusy(true); if (await run(async () => { const result = await authClient.signOut(); if (result.error)
        throw Error('Não foi possível sair.'); }))
        location.assign('/login');
    else
        setBusy(false); }}>Sair</Button></div></details>;
}
