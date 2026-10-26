"use client";
import { useState } from 'react';
import { billingCatalog, type BillingReview, type BillingView, type PackOffer } from '@/domain/billing';
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
function FutureCard({ title, description }: {
    title: string;
    description: string;
}) {
    return <article className="billing-addon-card unavailable"><h4>{title}</h4><select aria-label={'Quantidade de ' + title.toLowerCase()} disabled><option>1 unidade</option></select><p>{description}</p><Badge>Em breve</Badge><Button disabled>Indisponível para contratação</Button></article>;
}
export function BillingCatalog({ view, onChoose }: {
    view: BillingView | null;
    onChoose: (kind: BillingReview['kind'], sku: string) => void;
}) {
    const c = billingCatalog(), manage = !!view?.configured && view.canManage;
    return <div className="billing-catalog">
  <BillingPanel title="Pacotes Adicionais" icon="Package"><p>Aumente seus créditos sem trocar de plano. Compra única, sem renovação automática.</p><div className="billing-addon-grid">
   <PackCard title="Extrações de Leads" description="Adicione créditos para extrair novos leads de CNPJ e Google." packs={c.packs.filter(p => p.unit === 'extractions')} view={view} onChoose={onChoose}/>
   <PackCard title="Importações" description="Importe mais leads da sua própria base, por CSV ou cadastro manual." packs={c.packs.filter(p => p.unit === 'imports')} view={view} onChoose={onChoose}/>
   <FutureCard title="Contas de E-mail" description="Capacidade adicional de contas de e-mail."/>
   <FutureCard title="Números de WhatsApp" description="Capacidade adicional de números de WhatsApp."/>
   <FutureCard title="Usuários Extras" description="Mais usuários para trabalhar com sua equipe."/>
   <FutureCard title="Módulo LinkedIn" description="Recursos de prospecção pelo LinkedIn."/>
   <PackCard title="Enriquecimento (dados de sócios)" description="Créditos para consultar dados de empresas e decisores. Disponível em breve." packs={c.packs.filter(p => p.unit === 'enrichment')} view={view} onChoose={onChoose}/>
  </div><p className="billing-fine-print">Os créditos adicionais não expiram e são usados depois da franquia do plano. A compra só libera créditos após a confirmação do pagamento.</p></BillingPanel>
  <BillingPanel title="Comparação de planos" icon="Layers"><div className="billing-cycle"><span>Mensal</span></div><div className="billing-comparison-grid">{c.plans.map(p => <article key={p.code} className={'billing-comparison-plan ' + (p.code === 'pro' ? 'is-pro' : '')}><div className="billing-plan-ribbon">{view?.plan === p.code ? 'Seu plano' : p.code === 'pro' ? 'Pro' : 'Essential'}</div><div className="billing-comparison-heading"><Icon name={p.code === 'pro' ? 'Crown' : 'Zap'} size={27}/><h4>{p.name}</h4><p>{p.code === 'essential' ? 'Para começar sua prospecção ativa' : 'Para ampliar sua operação'}</p></div><div className="billing-comparison-price">{money(p.amount)}<small>/mês</small></div><ul>{[p.allowances.extractions.toLocaleString('pt-BR') + ' extrações de leads por mês', p.allowances.imports.toLocaleString('pt-BR') + ' importações por mês', p.capacity.mailboxes + ' contas de e-mail', p.capacity.whatsapp + ' números de WhatsApp', p.capacity.seats + ' usuários', p.capacity.cadences + ' cadências ativas', p.capacity.automations + ' automações ativas'].map(t => <li key={t}><Icon name="Check" size={15}/>{t}</li>)}</ul><Button variant={p.code === 'pro' ? 'primary' : ''} disabled={!manage || (view?.status === 'active' && view.plan === p.code)} onClick={() => onChoose(view?.status === 'active' ? (p.code === 'pro' ? 'upgrade' : 'downgrade') : 'checkout', p.code)}>{view?.status === 'active' ? (view.plan === p.code ? 'Seu plano' : p.code === 'pro' ? 'Fazer Upgrade' : 'Agendar downgrade') : 'Revisar assinatura'}</Button></article>)}</div></BillingPanel>
  <BillingPanel title="Funcionalidades por plano" icon="ListChecks"><div className="table-scroll"><table className="billing-feature-table"><thead><tr><th>Recurso</th><th>Essential</th><th>Pro</th></tr></thead><tbody>{[['Extrações de leads por mês', '5.000', '8.000'], ['Importações de leads por mês', '5.000', '15.000'], ['Contas de e-mail', '3', '5'], ['Números de WhatsApp', '2', '3'], ['Usuários', '2', '3'], ['Cadências ativas', '100', '100'], ['Automações ativas', '50', '50'], ['E-mails por dia', '100 por caixa · 300 na conta', '100 por caixa · 500 na conta']].map(([name, a, b]) => <tr key={name}><th scope="row">{name}</th><td>{a}</td><td>{b}</td></tr>)}</tbody></table></div></BillingPanel>
 </div>;
}
