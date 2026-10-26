"use client";
import { useId, type ReactNode } from 'react';
import { Icon } from '@/components/ui/icon';
export function BillingPanel({ title, icon, children, defaultOpen = true }: {
    title: string;
    icon: string;
    children: ReactNode;
    defaultOpen?: boolean;
}) {
    const id = useId();
    return <details className="billing-panel" open={defaultOpen}><summary aria-controls={id}><Icon name={icon} size={19}/><h3>{title}</h3><Icon name="ChevronUp" size={16}/></summary><div id={id} className="billing-panel-body">{children}</div></details>;
}
