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

**Piloto externo em andamento (24/10/2026).** A chave local foi validada na API e pertence ao sandbox “Prometeus Cadence — Homologação” (`acct_1UUHT9Pe2NaLsMbF`). Foi criado o webhook de teste `we_1UUHZQPe2NaLsMbFh2tZZGqJ`, com os 16 eventos acima e versão `2026-09-30.endive`; o segredo foi salvo somente em `.env.local`. O túnel temporário encaminha exclusivamente `POST /api/billing/webhook`. Smoke real: cobrança autenticada HTTP200 com `configured=true`, webhook sem assinatura HTTP400 e acesso público a `/login` HTTP404. Aplicativo e seis lanes foram reiniciados e conferidos sem falhas.

O checkout Essential de R$397/mês foi criado pelo fluxo autenticado de preparação/confirmação do aplicativo no workspace Agência Prometeus. Os helpers e os registros locais estão em `.runtime/billing-sandbox-*`, sem segredos nos relatórios. O plugin instalado retornou `Unknown tool` nas tentativas de listar contas e buscar documentação; a configuração foi realizada pela API com a chave de teste já autorizada.

**Assinatura inicial homologada em 25/10/2026, às 00:02 (America/Sao_Paulo).** Após o usuário concluir o checkout com cartão fictício, a API da Stripe confirmou `livemode=false`, checkout `complete/paid`, assinatura `sub_1UUHfmPe2NaLsMbFknFebR6v` ativa e fatura `in_1UUHfkPe2NaLsMbFJqAa09SB` paga em R$397, com zero pendente. O customer confere com o workspace local. A operação `13943835-c9b0-41e2-b28a-7dfec9ff6a83` terminou `completed`; o aplicativo apresenta Essential ativo até 25/11/2026, às 00:00:36 no fuso local. Os três eventos reais assinados (`invoice.paid`, `customer.subscription.created`, `checkout.session.completed`) chegaram ao receptor e terminaram `done`, todos em uma tentativa, sem erro. A leitura autenticada de `/api/billing` retornou `active`.

Conferência dos direitos: exatamente uma concessão ativa do plano para cada unidade (5.000 extrações, 5.000 importações, 50 de enriquecimento e zero SDR), sem consumo ou reserva no momento da prova; as concessões anteriores do piloto foram revogadas, impedindo soma indevida. A franquia de enriquecimento não significa executor operacional antes do marco06B. Evidência sanitizada em `.runtime/billing-payment-verification.json`; verificador `.runtime/billing-payment-verify.mjs` concluído com `initialSubscriptionVerified=true`.

**Fechamento do restante do ciclo em26/10/2026:** alteração da forma de pagamento, pacotes, mudanças de plano, falha/recuperação, renovação, cancelamento e retomada homologados em sandbox próprio no [06A-H](06-billing-homologation.md), com distinção explícita entre Test Clock e tempo real. Portal configurado,44 eventos assinados processados sem pendências e assinatura original preservada. O túnel HTTPS continua temporário e sua URL precisa ser atualizada se ele for recriado. Nenhuma cobrança live foi criada.

Enriquecimento, LinkedIn/SDR e capacidades avulsas continuam dependentes dos marcos posteriores e não são vendidos como executores prontos.

P3 adiado: backfill dos eventos iniciais de grant dos pilotos no ledger, detalhado na revisão. Saldos, consumo e reservas continuam preservados nas tabelas; não se trata de pagamento Stripe.
