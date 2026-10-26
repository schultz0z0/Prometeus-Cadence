"use client";
import { useState } from 'react';
import type { BillingReview, BillingView, BillingOperation } from '@/domain/billing';
import type { BillingClient } from '@/client/billing-client';
import { Modal, Button, Field, Notice } from '@/components/ui/primitives';
import { money, date } from './billing-summary';
export function BillingDialog({ review, client, onClose, onChanged }: {
    review: BillingReview;
    client: BillingClient;
    onClose: () => void;
    onChanged: () => Promise<void>;
}) {
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<BillingOperation | null>(null);
    async function confirm() { if (busy)
        return; setBusy(true); setError(''); try {
        setResult(await client.confirm(review));
        await onChanged();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Não foi possível confirmar.');
    }
    finally {
        setBusy(false);
    } }
    return <Modal title="Revisar alteração de cobrança" onClose={() => { if (!busy)
        onClose(); }}><div className="stack"><Notice>Ambiente de teste do Stripe. Nenhuma cobrança real é realizada nesta homologação.</Notice>{!result ? <><h3>{review.sku ?? ({ cancel: 'Cancelar renovação', resume: 'Retomar renovação', 'payment-method': 'Forma de pagamento', checkout: 'Compra', upgrade: 'Upgrade', downgrade: 'Downgrade' })[review.kind]}</h3><strong className="billing-review-total">{review.amount ? money(review.amount) : 'Sem cobrança imediata'}</strong><ul className="explainer-list">{review.effects.map(e => <li key={e}>{e}</li>)}</ul><small>Revisão válida até {date(review.expiresAt)}.</small><div className="form-actions"><Button disabled={busy} onClick={onClose}>Voltar</Button><Button variant="primary" disabled={busy || Date.parse(review.expiresAt) <= Date.now()} onClick={confirm}>{busy ? 'Confirmando…' : 'Confirmar alteração'}</Button></div></> : <><p role="status">{result.state === 'awaiting_payment' ? 'Aguardando pagamento. O acesso será atualizado após a confirmação do Stripe.' : result.state === 'completed' ? 'Alteração registrada.' : result.state === 'failed' ? 'A alteração não foi autorizada.' : 'Conciliação em andamento. Aguarde antes de repetir a operação.'}</p>{result.url && <a className="btn primary" href={result.url} target="_blank" rel="noopener noreferrer">Continuar no Stripe</a>}<Button onClick={onClose}>Fechar</Button></>}{error && <p className="error-bar" role="alert">{error}</p>}</div></Modal>;
}
export function BillingContactForm({ view, client, onChanged, accountEmail, onSaved }: {
    view: BillingView;
    client: BillingClient;
    onChanged: () => Promise<void>;
    accountEmail?: string;
    onSaved?: () => void;
}) {
    const [email, setEmail] = useState(view.contact.email ?? ''), [phone, setPhone] = useState(view.contact.phone ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false), [attempt, setAttempt] = useState<{
        expectedRevision: number;
        email: string | null;
        phone: string | null;
    } | null>(null);
    return <form className="billing-contact-form" data-workspace-editing={email !== (view.contact.email ?? '') || phone !== (view.contact.phone ?? '') ? 'true' : undefined} onSubmit={async (e) => { e.preventDefault(); if (busy)
        return; setBusy(true); setError(''); setSaved(false); const input = attempt ?? { expectedRevision: view.revision, email: email.trim() || null, phone: phone.trim() || null }; setAttempt(input); try {
        await client.contact(input);
        await onChanged();
        setAttempt(null);
        setEmail(input.email??'');
        setPhone(input.phone??'');
        setSaved(true);
        onSaved?.();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Não foi possível salvar.');
        if(e&&typeof e==='object'&&'status' in e&&[400,401,403,409,422].includes(Number(e.status))){setAttempt(null);if(Number(e.status)===409)void onChanged().catch(()=>{});}
    }
    finally {
        setBusy(false);
    } }}>
 <div className="billing-contact-fields"><Field label="E-mail de cobrança" help="Deixe em branco para usar o e-mail da conta."><input type="email" placeholder={accountEmail ?? 'financeiro@empresa.com.br'} maxLength={254} value={email} disabled={busy || !!attempt} onChange={e => { setEmail(e.target.value); setSaved(false); }}/></Field><Field label="Telefone de cobrança" help="Opcional. Aparece no cadastro de cobrança do Stripe."><input type="tel" pattern={String.raw`\+?[0-9 \(\)\-]{7,30}`} placeholder="+55 11 91234-5678" maxLength={30} value={phone} disabled={busy || !!attempt} onChange={e => { setPhone(e.target.value); setSaved(false); }}/></Field></div>
 {error && <p role="alert" className="error-bar">{error}</p>}<div className="row wrap"><Button icon="Save" variant="primary" disabled={busy}>{busy ? 'Salvando…' : attempt ? 'Repetir a mesma atualização' : 'Salvar contato de cobrança'}</Button>{saved && <span role="status" className="green-text">Contato de cobrança salvo.</span>}</div></form>;
}
export function BillingContact({ view, client, onClose, onChanged }: {
    view: BillingView;
    client: BillingClient;
    onClose: () => void;
    onChanged: () => Promise<void>;
}) {
    return <Modal title="Contato de cobrança" onClose={onClose}><BillingContactForm view={view} client={client} onChanged={onChanged} onSaved={onClose}/></Modal>;
}
