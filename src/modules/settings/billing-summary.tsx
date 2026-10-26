"use client";
import type { BillingView } from '@/domain/billing';
import { getPlan } from '@/domain/billing';
import { useDemo } from '@/demo/provider';
import { Badge, Button, Notice } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icon';
export const money = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n / 100);
export const date = (value: string | null) => value ? new Date(value).toLocaleString('pt-BR') : '—';
export const shortDate = (value: string | null) => value ? new Date(value).toLocaleDateString('pt-BR') : '—';
const number = (n: number) => n.toLocaleString('pt-BR');
export const statusNames: Record<BillingView['status'], string> = { inactive: 'Sem assinatura ativa', trial: 'Teste de 7 dias', pilot: 'Piloto local', active: 'Assinatura ativa', past_due: 'Pagamento pendente', canceled: 'Assinatura encerrada', attention: 'Ação necessária' };
function UsageCard({ label, description, used, limit, reset, reserved = 0 }: {
    label: string;
    description?: string;
    used: number;
    limit: number | null;
    reset?: string | null;
    reserved?: number;
}) {
    const percent = limit ? Math.round(used / limit * 100) : 0;
    return <div className="billing-usage-card"><h4>{label}</h4>{description && <p className="billing-usage-description">{description}</p>}<div className="billing-usage-value"><strong>{number(used)}</strong>{limit === null ? <Badge tone="orange">Ilimitado</Badge> : <span>/ {number(limit)}</span>}</div>{limit !== null && <><div className="billing-usage-track" role="progressbar" aria-label={label} aria-valuenow={used} aria-valuemin={0} aria-valuemax={Math.max(limit, used)}><i className={percent >= 100 ? 'full' : percent >= 80 ? 'warning' : ''} style={{ width: Math.min(100, percent) + '%' }}/></div><small>{percent}% utilizado{reset ? ' · Renova ' + shortDate(reset) : ''}</small></>}{reserved > 0 && <small>{number(reserved)} reservados em execuções</small>}</div>;
}
export function BillingSummary({ view, onTrial, onCatalog }: {
    view: BillingView;
    onTrial: () => void;
    onCatalog: () => void;
}) {
    const data = useDemo(), plan = getPlan(view.plan ?? 'essential'), extractions = view.balances.find(b => b.unit === 'extractions'), imports = view.balances.find(b => b.unit === 'imports');
    const used = (unit: 'extractions' | 'imports') => ['active', 'trial', 'pilot'].includes(view.status) ? Math.max(0, plan.allowances[unit] - (view.balances.find(b => b.unit === unit)?.plan ?? 0)) : (view.balances.find(b => b.unit === unit)?.consumed ?? 0);
    const good = ['active', 'trial', 'pilot'].includes(view.status), warning = [extractions, imports].some(b => b && b.plan === 0);
    return <div className="billing-summary"><section className={'billing-plan-overview ' + (view.plan === 'pro' ? 'is-pro' : '')}>
  <div className="billing-overview-header"><div className="billing-plan-symbol"><Icon name="Zap" size={26}/></div><div className="billing-plan-intro"><div className="row wrap"><h2>Plano {plan.name}</h2><Badge tone={view.status === 'active' ? 'green' : 'neutral'}>{statusNames[view.status]}</Badge></div><p>{view.trialAvailable ? 'Comece seu teste grátis de 7 dias. Nenhuma cobrança é feita durante o teste.' : view.status === 'active' ? (view.cancelAtPeriodEnd ? 'Renovação cancelada. Seu acesso continua até o fim do período pago.' : 'Seu plano está ativo. Acompanhe o consumo e os limites da sua conta.') : view.status === 'pilot' ? 'Você está usando o piloto local de homologação.' : statusNames[view.status]}</p><div className="billing-overview-price"><strong>{view.trialAvailable ? 'R$ 0 até ativar' : money(plan.amount)}</strong><span>{view.trialAvailable ? ' · depois ' + money(plan.amount) + '/mês' : '/mês'}{view.periodEnd ? ' · ' + (view.cancelAtPeriodEnd ? 'Acesso até ' : view.status === 'active' ? 'Renova em ' : 'Válido até ') + shortDate(view.periodEnd) : ''}</span></div></div><div className="billing-overview-actions">{view.trialAvailable ? <Button variant="primary" icon="Sparkles" onClick={onTrial}>Começar o teste grátis</Button> : <Button onClick={onCatalog}>Ver planos e adicionais</Button>}{view.trialAvailable && <button className="billing-text-action" onClick={onCatalog}>ou conhecer o Pro</button>}</div></div>
  <div className="billing-overview-usage"><div className="row between"><h3>Uso do plano</h3><Badge tone={good && !warning ? 'green' : 'orange'}><Icon name={good && !warning ? 'Check' : 'AlertCircle'} size={12}/>{good ? (warning ? 'Franquia esgotada' : 'Normal') : statusNames[view.status]}</Badge></div><div className="billing-usage-grid"><UsageCard label="Extrações de leads/mês" description="Base CNPJ, Google Maps e Search, automações e LinkedIn" used={used('extractions')} limit={plan.allowances.extractions} reset={extractions?.nextReset} reserved={extractions?.reserved}/><UsageCard label="Importações/mês" description="Planilha (CSV), cadastro manual, Apollo e API" used={used('imports')} limit={plan.allowances.imports} reset={imports?.nextReset} reserved={imports?.reserved}/><UsageCard label="Contas de Email" used={view.usage.mailboxes ?? 0} limit={view.capacity?.mailboxes ?? 0}/><UsageCard label="Cadências ativas" used={view.usage.cadences ?? 0} limit={view.capacity?.cadences ?? 0}/><UsageCard label="Templates" used={data.templates.length} limit={null}/><UsageCard label="Automações ativas" used={view.usage.automations ?? 0} limit={view.capacity?.automations ?? 0}/></div><p className="billing-usage-footnote">{number(used('extractions'))} de {number(plan.allowances.extractions)} extrações este mês{extractions?.nextReset ? ' · renova em ' + shortDate(extractions.nextReset) : ''} · {number(data.leads.length)} leads armazenados</p></div>
 </section>{view.nextPlan && <Notice>Mudança para {getPlan(view.nextPlan).name} agendada para a próxima renovação.</Notice>}<div className="billing-account-limits"><span><Icon name="Users" size={15}/>Usuários: <strong>{(view.usage.seats ?? 0) + (view.usage.pendingSeats ?? 0)} / {view.capacity?.seats ?? '—'}</strong></span><span><Icon name="MessageCircle" size={15}/>WhatsApp: <strong>{view.usage.whatsapp ?? 0} / {view.capacity?.whatsapp ?? '—'}</strong></span><span>Os limites de envio de cada canal também se aplicam.</span></div><section className="billing-credit-summary"><h3>Créditos adicionais</h3><div className="billing-credit-items">{view.balances.filter(b => b.unit === 'extractions' || b.unit === 'imports').map(b => <div key={b.unit}><span>{b.unit === 'extractions' ? 'Extrações de leads' : 'Importações'}</span><strong>{number(b.purchased)} créditos</strong><small>{number(b.plan)} disponíveis no plano · {number(b.reserved)} reservados</small></div>)}<Button onClick={onCatalog}>Ver pacotes adicionais</Button></div><p>Os créditos do plano são usados primeiro. Créditos adicionais não expiram.</p></section></div>;
}
