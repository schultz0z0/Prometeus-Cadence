# Billing06A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Execução nativa explicitamente escolhida pelo usuário; não delegar implementação. Steps use checkbox syntax for tracking.

**Goal:** Assinatura Stripe sandbox, trial de7 dias e pacotes pré-pagos com direitos/quotas transacionais no servidor.

**Architecture:** Catálogo imutável versionado; PostgreSQL com RLS, funções privilegiadas restritas e ledger de concessão/reserva/consumo. Um adaptador Stripe via HTTPS e worker com fila durável reconciliam operações/eventos sem confiar no retorno do navegador. Guardas nas mutações e antes da chamada externa preservam os limites existentes e resultados já recebidos.

**Tech Stack:** Next16.4.2/React19, Node24, TypeScript, Zod4, PostgreSQL, node:crypto/fetch. Nenhuma biblioteca de pagamento nova; cartão permanece no Checkout hospedado.

**Spec:** docs/superpowers/specs/2026-10-24-prometeus-cadence-06-billing-design.md

## Global Constraints

- Trial:7 dias, ativação explícita pelo proprietário, uma vez por workspace; sem cobrança automática ao expirar.
- Stripe somente teste. Essential39700/Pro89700 centavos BRL mensais; anual não habilitado no primeiro piloto.
- Compra de pacote é única; sem expiração; franquia antes de saldo comprado; nunca vender executor ausente.
- Capacidade extra não é vendida; OpenWA continua20 mensagens/5 novos contatos por dia, sem promessa antibloqueio.
- Nenhuma concessão por URL, payload do cliente ou evento sem assinatura. Idempotência local não expira com a janela do Stripe.
- Não cobrar histórico: corte de medição explícito, piloto local identificado. Novos workspaces sem assinatura não recebem piloto automático.
- Reutilizar serviços, isolamento e runtime; não alterar dados do concorrente ou enviar mensagens reais nesta entrega.
- Todo comando shell usa RTK; helpers Windows ocultos. Não exibir segredos.

## Review Focus

1. Dois checkouts concorrentes ou restart após aceitar no Stripe não podem gerar assinatura/crédito em dobro — testes Tasks3–4.
2. Expiração, cancelamento e downgrade durante um job não podem iniciar novo gasto nem perder recibo já recebido — testes Tasks2/5.
3. Operador, workspace trocado, cadastro de preço adulterado e credencial live devem ser negados no servidor — testes Tasks1/4/6.
4. Compra ou renovação reembolsada/repetida/fora de ordem não pode gerar saldo fictício — testes Task4.
5. Edição, duplicata e migração não podem debitar como novo lead; reserva incerta não pode ser liberada cedo — testes Tasks2/5.

## File Structure

- Domain: src/domain/billing.ts (catálogo, unidades, datas e contratos).
- Storage: db/migrations/067-billing.sql a073-billing-review-fixes.sql (RLS, ledger e guardas); scripts/provision-billing.mjs (papel dedicado sem bypass).
- Server: src/server/billing/{config,db,repository,entitlements,stripe,signature,operations,events,worker,http}.ts.
- Routes: src/app/api/billing/route.ts; src/app/api/billing/[action]/route.ts; src/app/api/billing/webhook/route.ts.
- UI: src/modules/settings/{plan,billing-summary,billing-catalog,billing-dialog}.tsx; src/client/billing-client.ts.
- Runtime: scripts/runtime-{core,lane,supervisor}.ts e scripts/runtime-control.mjs, com lane billing limitada.
- Integrações de quota: workspaces/commands, prospecting/{job-store,ingestion,journal,usage,worker-db}, automations/authorization, messaging/dispatch e funções SQL de capacidade.
- Tests: tests/billing.test.ts, tests/billing-stripe.test.ts, tests/integration/billing-{storage,entitlements,events,http,guards}.test.ts, fixtures em tests/integration/billing-helpers.ts.

### Task1: Catálogo, trial e transportes seguros

**Files:** domain/billing.ts; billing/config.ts,signature.ts,stripe.ts; tests/billing.test.ts,billing-stripe.test.ts.

**Interfaces:** getPlan('essential'|'pro'), getSku(code), trialEnd(start):string; billingConfig(env) com configured/mode; verifyStripeEvent(bytes,header,secret,now); createStripeAdapter(fetcher,config) com request/read/createCheckout.

- [x] Escrever testes: preços39700/89700, quotas5000/8000 e5000/15000, trial exatamente604800 segundos, sku desconhecido/live negados, assinatura HMAC sobre bytes exatos/timestamp/múltiplos v1 e tampering rejeitado.
- [x] RED: rtk node --experimental-strip-types --test tests/billing.test.ts tests/billing-stripe.test.ts; esperar falha por contrato ausente.
- [x] Implementar catálogo sem capacidades avulsas, transporte com origem fixa, timeout e limite de corpo, Stripe-Version2026-09-30.endive e sem retry financeiro automático.
- [x] GREEN: mesmo comando, todos passam; commit feat: define billing catalog and Stripe sandbox contracts.

### Task2: Persistência e consumo atômico

**Files:**067-billing.sql; provision-billing.mjs; db-migrate/test-integration; billing/db.ts,repository.ts,entitlements.ts; billing-storage/entitlements tests.

**Interfaces:** readBilling(p):BillingView; startTrial(p,requestId):BillingView; reserveCommercial(c,key,unit,n),consumeCommercial(c,key,unit,n,reservationKey?),releaseCommercial(c,key),assertExecution(c).

- [x] Testar sem direito por padrão, trial owner7 dias uma vez, RLS entre clientes, usuário SQL app não pode editar grants/status, duas reservas concorrentes não excedem saldo, FIFO franquia→pacote e expiração sem apagar dados.
- [x] RED: rtk npm run test:integration -- billing-storage billing-entitlements; esperar falhas das funções/tabelas novas.
- [x] Implementar papel cadence_billing dedicado, tabelas de conta/operação/evento/fatura/grant/reserva/ledger; somente funções autorizadas escrevem direitos. Piloto de migração só nos workspaces já existentes.
- [x] GREEN e commit feat: persist billing entitlements and atomic credit ledger.

### Task3: Operações revisadas e Checkout

**Files:** billing/operations.ts,stripe.ts,repository.ts; billing-stripe/storage tests.

**Interfaces:** prepareBilling(p,input):BillingReview; confirmBilling(p,{requestId,review}):BillingOperation; processBillingOperation(id,adapter):Promise<boolean>. O review vincula usuário/workspace/revisão/sku/custo/expiração.

- [x] Testar replay igual retorna mesma intenção, preço/moeda/workspace adulterados negados, concorrência retorna intenção em andamento, falha após aceite remoto recupera sessão com mesma chave e operação antiga incerta não inicia nova cobrança.
- [x] RED dos testes adicionados; implementar lease e persistir estágio remoto antes de cada chamada; limites de sessão e retorno permitido; comprar pacote requer executor/assinatura válidos.
- [x] GREEN e commit feat: add reviewed sandbox checkout operations.

### Task4: Eventos, renovação e mudanças de assinatura

**Files:** billing/events.ts,worker.ts,stripe.ts; billing-events tests.

**Interfaces:** receiveBillingEvent(event):eventId; processBillingEvent(id,adapter); syncSubscription(customer,adapter); processBillingTick({limit,signal}).

- [x] Testar retorno forjado sem pagamento não concede; invoice paga renova uma vez; repetição/fora de ordem lê estado atual; cancelamento respeita fim; upgrade usa prévia/pagamento e downgrade agenda; refund/disputa congela saldo não consumido para revisão.
- [x] RED: rtk npm run test:integration -- billing-events; implementar inbox durável, materialização validada contra catálogo, concessões únicas e conciliação periódica limitada.
- [x] GREEN e commit feat: reconcile Stripe billing lifecycle and refunds.

### Task5: Quotas em todos os caminhos reais

**Files:**070-billing-guards.sql e integrações indicadas no File Structure; billing-guards tests.

**Interfaces:** mesmos contratos comerciais Task2; current-setting de job inclui lease validada; funções de capacidade usam lock por workspace e estado persistido.

- [x] Testar importação manual/API/job concorrentes, duplicata/edição sem débito, cancelamento/recibo tardio, expiração antes do próximo gasto, canal/assento/cadência/automação acima da capacidade e tentativa SQL direta sem direito.
- [x] RED: rtk npm run test:integration -- billing-guards; implementar consumo na inserção real e reserva em job revisado; guardar chamadas externas e capacidade sem bloquear leitura/rascunhos/limpeza.
- [x] GREEN e regressões relevantes dos canais/prospecção; commit feat: enforce commercial quotas across commands and workers.

### Task6: API e interface de cobrança

**Files:** billing/http.ts, billing routes, billing-client e settings billing components; billing-http tests e verificação UI.

**Interfaces:** GET/api/billing →BillingView; POST/api/billing/{trial,prepare,confirm,contact,reconcile}; webhook recebe bytes crus sem sessão e com assinatura.

- [x] Testar origens, sessão, permissão atual, body limitado, método inválido, workspace trocado e ausência de segredo sem vazamento.
- [x] RED dos testes HTTP; implementar três abas com saldo/status reais, trial7 dias, popups de revisão, cobrança pendente e capacidades indisponíveis claramente identificadas. Atualização contínua preserva inputs.
- [x] GREEN; navegar em fixture por estados sem assinatura/trial/ativo/erro/pagamento pendente; commit feat: connect billing API and reviewed plan interface.

### Task7: Runtime, migração local e homologação

**Files:** runtime lanes, configuração documentada e docs/validation/06-billing.md.

**Interfaces:** lane billing executa processBillingTick, intervalo mínimo5s e lote máximo10, backoff existente; processos ocultos e sem sobreposição.

- [x] Escrever teste de configuração/launcher para lane billing; RED e implementação; GREEN.
- [x] Executar rtk npm test; rtk npm run test:integration; rtk npm run typecheck; rtk npm run build; rtk git diff --check. Esperado: zero falhas.
- [x] Aplicar migração local sem reiniciar/alterar outros projetos; verificar conta piloto e serviços. Não iniciar compra ou conectar merchant sem credenciais próprias.
- [x] Com credenciais Stripe sandbox, homologar checkout/eventos. Sem elas, registrar exatamente o bloqueio e manter aceite externo pendente; não dizer que o pagamento real funcionou.
- [x] Revisão final independente da branch conforme executing-plans, correções importantes RED→GREEN; registrar resultados, políticas e limitações; commit final.

## Self-review

Interfaces compartilhadas seguem BillingView/BillingReview/BillingOperation do domínio; funções de ledger operam na transação que já possui contexto/lock do workspace. Eventos usam papel separado; cliente nunca escreve concessão. Recursos06B/07 indisponíveis não serão comercializados por este marco. O usuário já aprovou desenho e execução nativa, com a alteração final de trial para7 dias; detalhamento do plano não abre nova rodada de permissão.

## Resultado da execução

Implementação nativa concluída com trial de7 dias. Validação e pendências em docs/validation/06-billing.md; revisão independente, correções e decisões em docs/validation/06-billing-review.md. O piloto financeiro externo permanece pendente pela ausência de credenciais Stripe sandbox, conforme a alternativa explícita da Task7. A branch local é preservada, sem merge/push automático.
