# 06A-H — homologação do ciclo financeiro existente

**Goal:** verificar mensalidade/pacotes, pagamento, alterações, renovação/falha e cancelamento no sandbox Stripe próprio, com efeitos locais reais e interface fiel às superfícies observadas.
**Spec:** `2026-10-26-prometeus-cadence-parity-closure.md`,06A-H; contratos existentes em `docs/validation/06-billing.md` e no desenho06A aprovado. Execução solicitada pelo usuário em26/10/2026, com instruções manuais somente quando necessárias.
**Architecture:** reaproveitar intents/reviews, adapters Stripe, webhook HMAC, fila durável, conciliação e quotas atuais. QA dedicado, sem alterar a assinatura da Agência Prometeus. Stripe Test Clocks somente em clientes de QA para avançar eventos de renovação; não alterar relógio do computador ou data de outros workspaces.
**Tech stack:** Next16, Better Auth, PostgreSQL/RLS, Stripe API2026-09-30.endive já fixada, runtime billing e Playwright CLI.

## Restrições e contratos

- Somente `sk_test_`, conta sandbox esperada e objetos `livemode=false`; nada live, mensagens a pessoas ou compras na referência.
- Preservar trial7 dias sem cartão/autocharge e créditos pré-pagos sem expiração. Anual/cupom/capacidade/recursos pendentes continuam06G.
- Criar fixtures próprios e manter ledger/teardown. Não tocar a assinatura Essential já homologada nem seus créditos.
- Portal de pagamento com configuração restrita a pagamento/histórico, sem habilitar troca/cancelamento por fora das revisões do aplicativo.
- API permanece fixada na versão compatível já homologada; instrução genérica da skill sobre versão mais nova não é motivo para migração de API neste marco.
- Não reconstruir o billing inteiro. Falhas reais do piloto recebem teste RED→GREEN e correção mínima. Estado virtual de Test Clock é declarado, não confundido com execução de créditos em tempo real futuro.

## Task1: preparar infraestrutura e fixtures

Arquivos: helpers privados `.runtime/m06h-*`, se necessário configuração `src/server/billing/config.ts`/adapter e testes correspondentes.

1. Conferir sandbox, preservação da assinatura existente, webhook e portal. Preflight encontrou webhook sem alcance e nenhuma configuração de portal.
2. Restaurar túnel exclusivo do webhook com processos ocultos; reutilizar endpoint e segredo existentes. Confirmar assinatura inválida rejeitada, demais rotas públicas não expostas e evento real assinado processado.
3. Criar configuração de portal dedicada/restrita e identidade/workspace QA; registrar IDs privados e baseline sanitizado. Clientes com relógio virtual pertencem somente ao QA.

Esperado: app/supervisor ativos, sandbox confirmado, fixtures isolados e caminho de entrada assinado operacional.

## Task2: homologar checkout, pacotes e pagamento

Interfaces: prepare/confirm HTTP autenticados, checkout Stripe real, retorno ao app, webhook/worker, grants/ledger/RLS.

1. Contratação de QA para permitir pacotes; confirmar ausência de direito antes do pagamento.
2. Compra única de extrações/importações via fluxo revisado, cartão fictício; exatamente uma concessão após pagamento. Repetir confirmação/eventos e comprovar ausência de duplicação. Checkout cancelado/expirado não concede crédito.
3. Configurar/abrir portal pelo app, atualizar cartão fictício e comprovar estado no Stripe; nenhum cartão real. Instruir o usuário apenas se existir autenticação/desafio que exija sua intervenção.

Esperado: pacote correto/único, preço do servidor, nenhuma ativação pelo simples retorno de URL, pagamento atualizado sem expor dados de cartão ao servidor.

## Task3: alterações e ciclo de vida

Arquivos se necessário: `src/server/billing/{stripe,operations,events}.ts`, migração aditiva, domínio/UI billing e testes unitários/integração.

1. Upgrade pago muda plano/diferença de franquia uma vez; upgrade com pagamento falho não antecipa direitos.
2. Downgrade agenda fim do período; renovação aplica novo plano/uma franquia. Usar API de relógio e leituras autoritativas reais, distinguindo limite virtual.
3. Falha de renovação restringe novas execuções conforme contrato; recuperação paga restaura somente direitos corretos. Cancelamento ao fim preserva acesso até o prazo/dados/créditos; encerramento bloqueia novas execuções. Retomada suportada deve ter caminho explícito e revisado; se faltar controle para situação reversível já contratada, completar o contrato mínimo e testá-lo.
4. Eventos fora de ordem/repetidos e resultado incerto não duplicam cobrança/grants. Valores/timestamps saem da Stripe; não falsificar payload para chamar de webhook real.

Esperado: estados e provas locais/remotos reconciliados, nenhuma alteração no workspace original, regressões reproduzidas/corrigidas.

## Task4: UI, regressão e entrega

Comparar estados reais das três abas/popups desktop/mobile; preservar o visual aprovado, adaptando controles de retomada coerentemente. Estados pagos da referência continuam não observados, conforme decisão anterior.

Rodar testes adequados de billing e integração, typecheck/build quando código mudar, conferir runtime, revisão final independente única e documentar em `docs/validation/06-billing-homologation.md`. Registrar cenários homologados separadamente dos sintéticos. Encerrar fixtures/agendamentos de QA quando possível sem perder a evidência; não declarar ciclo completo se uma dependência manual não tiver sido resolvida.

**Review focus:** isolamento/live guard, unicidade de concessões/cobranças, alterações/pagamentos pendentes, renovação/cancelamento/retomada, tempo virtual, eventos assinados e UI autoritativa.

## Encerramento26/10/2026

- [x] Task1: sandbox, webhook exclusivo, portal restrito e fixtures próprias.
- [x] Task2: Checkout, dois pacotes pagos, replay sem duplicação, sessão não paga expirada e alteração de cartão fictício.
- [x] Task3: upgrade/downgrade, renovação/falha/recuperação, cancelamento/retomada/encerramento e recontratação, com assinatura original preservada.
- [x] Task4: correções com regressões, UI em1920/390/320px, revisão independente, build/tipos, runtime, documentação e encerramento QA.

Resultados/limites e provas em [06-billing-homologation](../../validation/06-billing-homologation.md). Próximo pacote:06C.1. Nenhuma etapa manual necessária para encerrar este escopo.
