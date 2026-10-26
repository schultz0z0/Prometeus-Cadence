"use client";
import { useEffect, useState } from 'react';
import type { BillingView } from '@/domain/billing';
import { createBillingClient } from './billing-client';
import { useLiveRefresh } from './use-live-refresh';
export function useShellBilling(workspaceId: string | null) {
    const [snapshot, setSnapshot] = useState<{
        workspaceId: string;
        view: BillingView;
    } | null>(null);
    useEffect(() => { if (!workspaceId)
        return; const api = createBillingClient({ workspaceId }); let active = true; const refresh = () => api.read().then(view => { if (active)
        setSnapshot({ workspaceId, view }); }).catch(() => { }); void refresh(); window.addEventListener('billing-updated', refresh); return () => { active = false; api.dispose(); window.removeEventListener('billing-updated', refresh); }; }, [workspaceId]);
    useLiveRefresh(async (signal) => { if (!workspaceId)
        return; const api = createBillingClient({ workspaceId }); try {
        const view = await api.read();
        if (!signal.aborted)
            setSnapshot({ workspaceId, view });
    }
    finally {
        api.dispose();
    } }, 30000, !!workspaceId, workspaceId);
    return snapshot?.workspaceId === workspaceId ? snapshot.view : null;
}
