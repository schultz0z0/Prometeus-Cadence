# Marco06A — validação da cobrança

24/10/2026. Implementação local em `codex/billing-06`. Trial **7 dias**, por instrução final do usuário. Stripe somente sandbox; mensalidade e pacotes pré-pagos.

## Entrega

- Essential R$397/mês e Pro R$897/mês; preços e moeda definidos no servidor. Modalidade anual e capacidade avulsa não habilitadas.
- Trial ativado explicitamente pelo proprietário, uma vez por workspace, sem cartão ou cobrança automática. Uma assinatura já contratada não pode ser substituída por outro trial.
- Checkout revisado, intenção durável, chave idempotente, lease e conciliação de resultados incertos; nenhuma ativação pelo retorno do navegador.
- Webhook com HMAC nos bytes originais; eventos persistidos antes de responder; leitura autenticada do estado atual do Stripe, concessões únicas, cancelamento ao fim, upgrade condicionado ao pagamento e downgrade agendado.
- Franquia antes dos pacotes, reserva/consumo/liberação atômicos e RLS. Guardas SQL nas inserções de lead/job, capacidade de canais/assentos/cadências/automações e na barreira final de envio.
- Dados e créditos preservados após expirar. Resultados já recebidos podem usar sua reserva; nova chamada externa exige direito vigente. Custos internos de provedor continuam separados.
- Abas Meu plano, Cobrança e Planos e pacotes com dados reais. Revisões e contato em popups; atualização contínua preserva rascunhos.
- Lane permanente `billing`, intervalo mínimo5s, lote até10 e backoff. Processos Windows ocultos, reaproveitando o supervisor existente.

## Provas

- Unitários finais:262/262, `.runtime/m06-review-final-unit.log`.
- Integração completa final:263/263, `.runtime/m06-review-final-integration.log`.
- Casos adicionais de lifecycle:7/7, `.runtime/m06-lifecycle-edge-green.log`: contestação sem customer, histórico fora de ordem, reembolso, trial após assinatura e mudanças de plano.
- TypeScript sem erros; build Next16.4.2 concluído; `git diff --check` sem erros.
- QA visual com respostas financeiras simuladas:7 estados, revisão de checkout, trial7 dias, contato não apagado pelo refresh, desktop1440px e celular390px. `.runtime/billing-ui/`; nenhum pagamento ou mensagem externa nesse QA.
- Ambiente local atualizado até073; antes/depois:10 workspaces,7 leads,4 conexões,13 jobs. Os workspaces existentes receberam piloto local identificado de7 dias; novos workspaces seguem inativos. Nenhuma cobrança retroativa.
- Aplicativo em127.0.0.1:3210 e6 lanes retomadas, todas vivas e sem falha na verificação. Smoke HTTP autenticado de cobrança executado sem expor sessão ou credenciais.
- Conferência da interface publicada localmente, sem simular a resposta de cobrança:3 abas, piloto local, texto de7 dias e nenhum erro de JavaScript.
- [Revisão independente, correções e decisões](06-billing-review.md):6 achados importantes corrigidos com regressões RED→GREEN. A correção de abortos aceitos em andamento também preserva o fluxo anterior de acompanhamento, sem repetir o POST; regressão de prospecção19/19 em `.runtime/m06-abort-progress-green.log`.

## Configuração e limite do aceite

`STRIPE_SECRET_KEY` precisa ser uma chave `sk_test_`; chave live é rejeitada. `STRIPE_WEBHOOK_SECRET` guarda o segredo de assinatura. Ambos permanecem somente no servidor. O endpoint é `/api/billing/webhook`, exposto por HTTPS no ambiente de homologação quando as credenciais forem configuradas.

Eventos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.created/updated/deleted/pending_update_expired/pending_update_applied`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `charge.refunded`, `charge.dispute.created/updated/closed`.

Frequência: `RUNTIME_BILLING_MS`5000–60000; `RUNTIME_BILLING_BATCH`1–10, padrão5. Fallback de assinaturas a cada5min e checkout pendente a cada30s, além dos webhooks. UI consulta a cada15s com pausa por visibilidade/conectividade. Reconciliação manual limitada a2/min por usuário/workspace.

**Pendente: piloto financeiro no Stripe.** Não há chave de teste nem segredo de webhook no ambiente local. Não foi criado merchant, cartão, pagamento, assinatura ou produto real no Stripe. A implementação e os testes por adaptador estão entregues; o aceite externo requer credenciais próprias e checkout/eventos reais no sandbox. Não considerar o marco financeiramente homologado antes dessa prova.

Enriquecimento, LinkedIn/SDR e capacidades avulsas continuam dependentes dos marcos posteriores e não são vendidos como executores prontos.

P3 adiado: backfill dos eventos iniciais de grant dos pilotos no ledger, detalhado na revisão. Saldos, consumo e reservas continuam preservados nas tabelas; não se trata de pagamento Stripe.
