"use client";
import { useState } from 'react';
import { billingCatalog, capacityOffer, CAPACITY_MAX, planChange, planSku, type CapacityUnit, type BillingInterval, type BillingReview, type BillingView, type PackOffer, type PlanOffer } from '@/domain/billing';
import { Button, Badge } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/icon';
import { BillingPanel } from './billing-panel';
import { money } from './billing-summary';
function PackCard({ title, description, packs, view, onChoose }: {
    title: string;
    description: string;
    packs: PackOffer[];
    view: BillingView | null;
    onChoose: (kind: BillingReview['kind'], sku: string) => void;
}) {
    const [code, setCode] = useState(packs[0].code), offer = packs.find(p => p.code === code)!;
    const eligible = !!view && ['active', 'trial', 'pilot'].includes(view.status), balance = view?.balances.find(b => b.unit === offer.unit);
    return <article className="billing-addon-card"><h4>{title}</h4><select aria-label={'Quantidade de ' + title.toLowerCase()} value={code} onChange={e => setCode(e.target.value)}>{packs.map(p => <option key={p.code} value={p.code}>+{p.quantity.toLocaleString('pt-BR')} {p.unit === 'enrichment' ? 'créditos' : p.unit === 'extractions' ? 'extrações' : 'importações'}, {money(p.amount)}</option>)}</select><p>{description}</p>{balance && <small className="billing-addon-balance">Saldo atual: {balance.plan.toLocaleString('pt-BR')} do plano + {balance.purchased.toLocaleString('pt-BR')} adicionais</small>}<div className="billing-addon-price">{money(offer.amount)}<small> /compra</small></div><Button icon="CreditCard" disabled={!view?.configured || !view.canManage || !eligible || !offer.available} onClick={() => onChoose('checkout', offer.code)}>{offer.available ? 'Comprar créditos' : 'Em breve'}</Button></article>;
}
function CapacityCard({ unit, title, description, view, onChoose }: {
    unit: CapacityUnit;
    title: string;
    description: string;
    view: BillingView | null;
    onChoose: (kind: BillingReview['kind'], sku: string, quantity?: number) => void;
}) {
    const [count, setCount] = useState(1), interval = view?.interval ?? 'month', offer = capacityOffer(unit, interval), extra = view?.capacityExtras?.[unit], active = extra?.active ?? 0, scheduled = extra?.scheduled ?? null, sku = 'capacity-' + unit;
    const blocked = !view?.configured ? 'Cobrança indisponível no momento.' : !view.canManage ? 'Somente proprietário ou administrador pode contratar.' : view.status !== 'active' ? 'Disponível com assinatura ativa.' : view.cancelAtPeriodEnd ? 'Retome a renovação para contratar.' : view.nextPlan ? 'Há uma mudança de plano agendada.' : null, can = !blocked && scheduled === null;
    return <article className="billing-addon-card"><h4>{title}</h4><select aria-label={'Quantidade de ' + title.toLowerCase()} value={count} onChange={e => setCount(Number(e.target.value))}>{Array.from({ length: 10 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n} {n === 1 ? 'unidade' : 'unidades'}</option>)}</select><p>{description}</p><small className="billing-addon-balance">{scheduled !== null ? `Unidades contratadas: ${active}. Reduz para ${scheduled} na renovação.` : `Unidades contratadas: ${active}`}</small><div className="billing-addon-price">{money(offer.amount)}<small> /{interval === 'year' ? 'ano' : 'mês'}</small></div>{blocked && <small className="billing-addon-balance">{blocked}</small>}<Button icon="CreditCard" disabled={!can || active + count > CAPACITY_MAX} onClick={() => onChoose('capacity', sku, active + count)}>Contratar</Button>{active > 0 && <button type="button" className="billing-text-action" disabled={!can} onClick={() => onChoose('capacity', sku, active - 1)}>Reduzir 1 unidade</button>}</article>;
}
function FutureCard({ title, description }: {
    title: string;
    description: string;
}) {
    return <article className="billing-addon-card unavailable"><h4>{title}</h4><select aria-label={'Quantidade de ' + title.toLowerCase()} disabled><option>1 unidade</option></select><p>{description}</p><Badge>Em breve</Badge><Button disabled>Indisponível para contratação</Button></article>;
}
export function BillingCatalog({ view, onChoose }: {
    view: BillingView | null;
    onChoose: (kind: BillingReview['kind'], sku: string, quantity?: number) => void;
}) {
    const c = billingCatalog(), manage = !!view?.configured && view.canManage, [cycle, setCycle] = useState<BillingInterval>(view?.interval === 'year' ? 'year' : 'month'), active = view?.status === 'active' && !!view.plan, locked = active && (!!view!.nextPlan || view!.cancelAtPeriodEnd);
    const shown = cycle === 'year' ? c.annualPlans : c.plans;
    const change = (p: PlanOffer) => active ? planChange(view!.plan!, view!.interval, p.code) : null;
    const isCurrent = (p: PlanOffer) => active && planSku(view!.plan!, view!.interval) === p.code;
    const label = (p: PlanOffer) => { if (!active) return 'Revisar assinatura'; if (isCurrent(p)) return 'Seu plano'; if (view!.nextPlan === p.code) return 'Agendado'; if (locked) return view!.nextPlan ? 'Mudança já agendada' : 'Retome a renovação'; const k = change(p); if (!k) return 'Mude o ciclo primeiro'; if (k === 'upgrade') return 'Fazer Upgrade'; return p.planCode === view!.plan ? (p.cycle === 'year' ? 'Mudar para anual na renovação' : 'Mudar para mensal na renovação') : 'Agendar downgrade'; };
    return <div className="billing-catalog">
  <BillingPanel title="Pacotes Adicionais" icon="Package"><p>Aumente seus créditos sem trocar de plano. Compra única, sem renovação automática.</p><div className="billing-addon-grid">
   <PackCard title="Extrações de Leads" description="Adicione créditos para extrair novos leads de CNPJ e Google." packs={c.packs.filter(p => p.unit === 'extractions')} view={view} onChoose={onChoose}/>
   <PackCard title="Importações" description="Importe mais leads da sua própria base, por CSV ou cadastro manual." packs={c.packs.filter(p => p.unit === 'imports')} view={view} onChoose={onChoose}/>
   <CapacityCard unit="mailboxes" title="Contas de E-mail" description="Adicione 1 conta de email extra ao seu plano" view={view} onChoose={onChoose}/>
   <CapacityCard unit="whatsapp" title="Números de WhatsApp" description="Conecte mais um número de WhatsApp à sua conta" view={view} onChoose={onChoose}/>
   <CapacityCard unit="seats" title="Usuários Extras" description="Adicione 1 usuário à sua conta" view={view} onChoose={onChoose}/>
   <FutureCard title="Módulo LinkedIn" description="Recursos de prospecção pelo LinkedIn."/>
   <PackCard title="Enriquecimento (dados de sócios)" description="Créditos para consultar dados de empresas e decisores. Disponível em breve." packs={c.packs.filter(p => p.unit === 'enrichment')} view={view} onChoose={onChoose}/>
  </div><p className="billing-fine-print">Os créditos adicionais não expiram e são usados depois da franquia do plano. A compra só libera créditos após a confirmação do pagamento. Contas, números e usuários são itens da assinatura ativa e renovam com ela.</p></BillingPanel>
  <BillingPanel title="Comparação de planos" icon="Layers"><div className="billing-cycle" role="group" aria-label="Ciclo de cobrança">{(['month', 'year'] as const).map(k => <button key={k} type="button" aria-pressed={cycle === k} className={cycle === k ? 'is-active' : ''} onClick={() => setCycle(k)}>{k === 'month' ? 'Mensal' : <>Anual <small>-20%</small></>}</button>)}</div><div className="billing-comparison-grid">{shown.map(p => <article key={p.code} className={'billing-comparison-plan ' + (p.planCode === 'pro' ? 'is-pro' : '')}><div className="billing-plan-ribbon">{isCurrent(p) ? 'Seu plano' : p.planCode === 'pro' ? 'Pro' : 'Essential'}</div><div className="billing-comparison-heading"><Icon name={p.planCode === 'pro' ? 'Crown' : 'Zap'} size={27}/><h4>{p.name}</h4><p>{p.planCode === 'essential' ? 'Para começar sua prospecção ativa' : 'Para ampliar sua operação'}</p></div><div className="billing-comparison-price">{money(p.cycle === 'year' ? p.amount / 12 : p.amount)}<small>/mês</small>{p.cycle === 'year' && <small className="billing-annual-total">cobrado {money(p.amount)}/ano</small>}</div><ul>{[p.allowances.extractions.toLocaleString('pt-BR') + ' extrações de leads por mês', p.allowances.imports.toLocaleString('pt-BR') + ' importações por mês', p.capacity.mailboxes + ' contas de e-mail', p.capacity.whatsapp + ' números de WhatsApp', p.capacity.seats + ' usuários', p.capacity.cadences + ' cadências ativas', p.capacity.automations + ' automações ativas'].map(t => <li key={t}><Icon name="Check" size={15}/>{t}</li>)}</ul><Button variant={p.planCode === 'pro' ? 'primary' : ''} disabled={!manage || locked || (active && !change(p))} onClick={() => { const k = active ? change(p) : 'checkout'; if (k) onChoose(k, p.code); }}>{label(p)}</Button></article>)}</div></BillingPanel>
  <BillingPanel title="Funcionalidades por plano" icon="ListChecks"><div className="table-scroll"><table className="billing-feature-table"><thead><tr><th>Recurso</th><th>Essential</th><th>Pro</th></tr></thead><tbody>{[['Extrações de leads por mês', '5.000', '8.000'], ['Importações de leads por mês', '5.000', '15.000'], ['Contas de e-mail', '3', '5'], ['Números de WhatsApp', '2', '3'], ['Usuários', '2', '3'], ['Cadências ativas', '100', '100'], ['Automações ativas', '50', '50'], ['E-mails por dia', '100 por caixa · 300 na conta', '100 por caixa · 500 na conta']].map(([name, a, b]) => <tr key={name}><th scope="row">{name}</th><td>{a}</td><td>{b}</td></tr>)}</tbody></table></div></BillingPanel>
 </div>;
}
