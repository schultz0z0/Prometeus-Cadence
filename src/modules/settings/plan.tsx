"use client";
import { useEffect, useState, useRef } from 'react';
import { useIdentity } from '@/client/workspace-provider';
import { createBillingClient, type BillingClient } from '@/client/billing-client';
import { useLiveRefresh } from '@/client/use-live-refresh';
import type { BillingView, BillingReview } from '@/domain/billing';
import { Button, Modal, Notice, Badge } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icon';
import { BillingSummary, money, date } from './billing-summary';
import { BillingCatalog } from './billing-catalog';
import { BillingPanel } from './billing-panel';
import { BillingDialog, BillingContactForm } from './billing-dialog';
const tabs = ['Meu plano', 'Cobrança', 'Planos e pacotes'];
export function Plan() { const identity = useIdentity(), workspaceId = identity?.activeWorkspaceId ?? null; return <BillingPage key={workspaceId ?? 'demo'} workspaceId={workspaceId}/>; }
function BillingPage({ workspaceId }: {
    workspaceId: string | null;
}) {
    const [client, setClient] = useState<BillingClient | null>(null), identity = useIdentity(), tablist = useRef<HTMLDivElement>(null);
    const [signupIntent,setSignupIntent]=useState<{plan:string;mode:string}|null>(null);
    useEffect(()=>{const q=new URLSearchParams(location.search),plan=q.get('signupPlan'),mode=q.get('signupMode');if((plan==='essential'||plan==='pro')&&(mode==='trial'||mode==='subscribe'))setSignupIntent({plan,mode});},[]);
    const [view, setView] = useState<BillingView | null>(null), [tab, setTab] = useState('Meu plano'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [review, setReview] = useState<BillingReview | null>(null), [trial, setTrial] = useState<object | null>(null);
    async function refresh() { if (client) {
        setView(await client.read());
        window.dispatchEvent(new Event('billing-updated'));
    } }
    useEffect(() => { let active = true; const api = workspaceId ? createBillingClient({ workspaceId }) : null; setClient(api); if (api)
        api.read().then(v => { if (active)
            setView(v); }).catch(e => { if (active)
            setError(e.message); }); return () => { active = false; api?.dispose(); }; }, [workspaceId]);
    useLiveRefresh(async (signal) => { if (!client)
        return; const v = await client.read(); if (!signal.aborted)
        setView(v); }, 15000, !!client, client);
    async function act(fn: () => Promise<void>) { if (busy)
        return; setBusy(true); setError(''); try {
        await fn();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Não foi possível concluir.');
    }
    finally {
        setBusy(false);
    } }
    const choose = (kind: BillingReview['kind'], sku?: string) => act(async () => { if (client)
        setReview(await client.prepare({ kind, ...(sku ? { sku } : {}) })); });
    return <div className="billing-page"><h1 className="sr-only">Plano e cobrança</h1><div className="billing-tabs" role="tablist" aria-label="Plano e cobrança" ref={tablist} onKeyDown={e => { const at = tabs.indexOf(tab), next = e.key === 'ArrowRight' ? (at + 1) % tabs.length : e.key === 'ArrowLeft' ? (at + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null; if (next !== null) {
        e.preventDefault();
        setTab(tabs[next]);
        tablist.current?.querySelectorAll<HTMLButtonElement>('button')[next].focus();
    } }}>{tabs.map((t, i) => <button key={t} id={'billing-tab-' + i} role="tab" aria-controls="billing-tabpanel" aria-selected={tab === t} tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)}>{t}</button>)}</div>
 {signupIntent&&<Notice>Você escolheu {signupIntent.plan==='pro'?'Pro':'Essential'}{signupIntent.mode==='trial'?' para conhecer o produto. O teste Essential de 7 dias ainda precisa ser ativado.':' para contratar após revisar os valores.'} Confira as opções abaixo. Nenhuma contratação foi feita pelo cadastro. <Button onClick={()=>{setTab('Planos e pacotes');setSignupIntent(null);}}>Ver opções</Button></Notice>}
 {error && <p role="alert" className="error-bar">{error}</p>}
 <div role="tabpanel" id="billing-tabpanel" aria-labelledby={'billing-tab-' + tabs.indexOf(tab)} className="billing-tab-content">
 {!client ? <><Notice>Entre em um workspace para consultar seu plano.</Notice><BillingCatalog view={null} onChoose={() => { }}/></> : !view ? <div className="billing-loading" role="status">Consultando assinatura…</div> : <>
 {!view.configured && <Notice>A cobrança de teste aguarda configuração.</Notice>}
 {view.operations.some(o => ['prepared', 'processing', 'uncertain', 'awaiting_payment'].includes(o.state)) && <Notice>Existe uma operação em andamento. Confira o resultado na aba Cobrança antes de tentar novamente.</Notice>}
 <div hidden={tab !== 'Meu plano'}><BillingSummary view={view} onTrial={() => setTrial({})} onCatalog={() => setTab('Planos e pacotes')}/></div><div hidden={tab !== 'Planos e pacotes'}><BillingCatalog view={view} onChoose={choose}/></div><div hidden={tab !== 'Cobrança'} className="billing-invoices">
 <BillingPanel title="Faturamento & Histórico" icon="ReceiptText"><div className="row between wrap"><h4 className="row"><Icon name="FileText" size={15}/>Histórico de Pagamentos</h4><button className="billing-text-action row" disabled={busy} onClick={() => act(refresh)}><Icon name="RefreshCw" size={13}/>Atualizar</button></div>
 {view.invoices.length ? <div className="table-scroll"><table className="billing-feature-table"><thead><tr><th>Data</th><th>Valor pago</th><th>Estado</th><th>Fatura</th></tr></thead><tbody>{view.invoices.map(i => <tr key={i.id}><td>{date(i.createdAt)}</td><td>{money(i.amount)}</td><td><Badge tone={i.status === 'paid' ? 'green' : 'orange'}>{i.status === 'paid' ? 'Paga' : i.status === 'open' ? 'Em aberto' : i.status}</Badge></td><td>{i.url ? <a className="billing-text-action" href={i.url} target="_blank" rel="noopener noreferrer">Ver fatura</a> : '—'}</td></tr>)}</tbody></table></div> : <div className="billing-empty">Nenhum pagamento registrado ainda.</div>}
 {view.canManage && <><div className="billing-management-actions"><Badge tone="orange">Stripe · teste</Badge>{['active','past_due','attention'].includes(view.status) && <Button disabled={busy || !view.configured} onClick={() => choose('payment-method')}>Forma de pagamento</Button>}{view.status === 'active' && <>{view.cancelAtPeriodEnd ? <Button disabled={busy || !view.configured} onClick={() => choose('resume')}>Retomar renovação</Button> : <Button disabled={busy || !view.configured} onClick={() => choose('cancel')}>Cancelar renovação</Button>}</>}<Button disabled={busy || !view.configured} onClick={() => act(async () => { setView(await client.reconcile()); })}>Confirmar estado do pagamento</Button></div><details className="billing-operation-history"><summary>Operações recentes</summary>{view.operations.length ? view.operations.map(o => <div className="billing-operation" key={o.id}><div><strong>{o.sku ?? ({ cancel: 'Cancelar renovação', resume: 'Retomar renovação', contact: 'Contato de cobrança', 'payment-method': 'Forma de pagamento' } as Record<string, string>)[o.kind] ?? 'Alteração de plano'}</strong><p>{date(o.createdAt)} · {{ prepared: 'Preparando', processing: 'Processando', uncertain: 'Em conciliação', awaiting_payment: 'Aguardando pagamento', completed: 'Confirmada', failed: 'Não concluída' }[o.state]}</p>{o.error && <small>{o.error}</small>}</div>{o.url && o.state !== 'failed' && <a className="btn" href={o.url} target="_blank" rel="noopener noreferrer">Abrir no Stripe</a>}</div>) : <p>Nenhuma operação registrada.</p>}</details></>}
 </BillingPanel>
 <BillingPanel title="Contato de cobrança" icon="Mail">{view.canManage ? <><p>Por padrão, os avisos de cobrança são enviados para o e-mail da sua conta{identity?.user.email ? ' (' + identity.user.email + ')' : ''}. Informe outro contato abaixo se quiser direcioná-los ao seu financeiro. Isso não altera seu e-mail de login.</p><BillingContactForm view={view} client={client} onChanged={refresh} accountEmail={identity?.user.email}/></> : <p>Somente proprietários e administradores podem alterar os dados de cobrança.</p>}</BillingPanel>
 </div>
 {review && <BillingDialog review={review} client={client} onClose={() => setReview(null)} onChanged={refresh}/>}
 {trial && <Modal title="Ativar teste gratuito de 7 dias" onClose={() => { if (!busy)
            setTrial(null); }}><div className="stack"><Notice>Franquias Essential durante 7 dias, sem cartão e sem cobrança automática. Uma ativação por workspace.</Notice><p>Depois do teste, seus dados permanecem. Novas execuções exigem assinatura válida.</p><div className="form-actions"><Button disabled={busy} onClick={() => setTrial(null)}>Voltar</Button><Button variant="primary" disabled={busy} onClick={() => act(async () => { setView(await client.trial(trial)); window.dispatchEvent(new Event('billing-updated')); setTrial(null); })}>{busy ? 'Ativando…' : 'Ativar por 7 dias'}</Button></div></div></Modal>}
 </>}
 </div><div className="billing-page-divider"/></div>;
}
