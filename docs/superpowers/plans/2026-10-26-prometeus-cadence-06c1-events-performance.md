# 06C.1 — eventos, desempenho e atualização contínua

> Execução nativa com executing-plans, TDD e uma revisão final independente. Continuação expressamente solicitada pelo usuário após o push da main em26/10. Branch: `codex/events-performance-06c1`, base `8e71f0a`.

**Goal:** consolidar mudanças operacionais persistentes, consultas limitadas e atualização contínua sem duplicação de requisições ou substituição de rascunhos.
**Spec:** [fechamento aprovado](2026-10-26-prometeus-cadence-parity-closure.md),06C.1; consumidores de dashboard/relatórios/notificações continuam06C.2/3.
**Architecture:** PostgreSQL/RLS registra transições reais na mesma transação que os módulos existentes. Feed incremental por workspace, sem conteúdo de mensagens/credenciais; métricas continuam autoritativas com limites temporais indexáveis e definições explícitas. Transporte coalesce GETs por instância/workspace e expira consultas travadas; atualizações preservam o snapshot de formulários em conflito. Não introduzir outro broker, dependência, serviço ou redesenho visual.

## Medição e orçamento

Baseline privado `.runtime/06c1-baseline.log`: cinco navegações completas autenticadas, sem writes;30GETs (snapshot/métricas/billing) e cinco snapshots concorrentes. No workspace pequeno atual: navegação182–330ms; APIs12–52ms; concorrência65–71ms. Primeira tentativa com rota inexistente e amostra billing sem header foram descartadas, não usadas como orçamento.

Orçamento local aquecido: p95≤250ms para esses GETs e≤1500ms para navegação; cinco solicitações simultâneas sem erro de isolamento. Fixtures grandes ficam somente no banco `_test`: feed limitado a100 itens; consulta incremental deve usar índice e retornar até100KB/página. Números de poucos registros não provam desempenho em produção nem em rede móvel.

## Task1 — eventos operacionais e leitura incremental

- [x] Teste RED em `tests/integration/operation-events.test.ts`: mudanças reais de conexão/job, no-op/replay/rollback, ordenação commitada, RLS/revogação, paginação/limites e ausência de segredos.
- [x] Migração076: journal só de metadados, cabeça serializada por workspace para cursor sem perda por commit fora de ordem; triggers em job, runtime automação, conexão/caixa, mensagem/outbox e conta financeira. Nenhuma inferência de transições históricas: registros prévios continuam nas tabelas de origem; journal começa na migração.
- [x] `src/server/operations/{repository,http}.ts`, domínio e `/api/operations/events`: validação estrita, cursor exclusivo/até100 registros, estado de transição, revisão e timestamp de registro. Sem cache entre usuários e sem SELECT global administrativo.
- [x] Testes GREEN e medição paginada em fixture grande/concorrente. Feed é base operacional para06C.2/3; não é ledger de entregas futuras nem substitui eventos autenticados dos provedores.

## Task2 — consulta de métricas por período/fuso

- [x] RED de fronteiras de dia/fuso, eventos futuros/antigos e segregação por workspace; confirmar definição de enviado/recebido humano, falha e pendência. Abertura/clique não medidos permanecem null.
- [x] Refatorar `src/server/messaging/metrics.ts`: corte por timestamps absolutos antes da agregação local, índice correspondente, limite exclusivo do próximo dia; evitar varrer todo o histórico fora do período. Preservar contrato dos consumidores.
- [x] GREEN com casos reais de persistência e plano de consulta de volume isolado. Séries/novas projeções visuais ficam06C.2.

## Task3 — atualização eficiente e rascunhos

- [x] RED em `tests/client-repository.test.ts`/transporte: GETs concorrentes idênticos compartilham uma chamada por instância; POSTs continuam independentes e revisados; falhas liberam retry; descarte/revogação cancela resposta; prazo de15s para GET travado.
- [x] `workspace-transport.ts`/`workspace-repository.ts`: coalescer leituras, sinais/prazos e preservar dados locais quando refresh encontra edição/conflito. Não bloquear atualização de segurança ou deixar resposta antiga sobrescrever commit novo.
- [x] Reutilizar polling15s/backoff60s/pausa oculto-offline já existentes. Medir solicitações repetidas em dashboard e mudança de período; nenhum push de dados de outro workspace. Refresh ao voltar é limitado, sem tempestade por focus.

## Task4 — fechar a entrega

- [x] Suites completas, build e typecheck; migração local, reinício oculto dos processos que mudaram e smoke autenticado. Não enviar mensagem, comprar assinatura nem alterar conta real.
- [x] Verificar navegação, rede indisponível/retorno, formulário não apagado e desktop/mobile, mantendo aparência aprovada. Comparação visual já inventariada permanece contrato; nenhum estado desconhecido vira paridade100%.
- [x] Revisão final única; corrigir achados importantes; publicar `docs/validation/06-events-performance.md` com baseline/depois, escopo e limites. Fixtures isoladas removidas pelo runner; browser original preservado. Próximo06B.1 na sequência revisada, seguido de06B.2/06D.

## Foco de revisão

Cursor/commit concorrente; trigger sem conteúdo privado e sem mudanças no contrato de autorização; no-op/rollback sem evento falso; datas/fuso e índices; GET/POST/retry sem coalescer mutações; revogação e respostas tardias; rascunho preservado sem permissões obsoletas; orçamento declarado por tamanho e ambiente.

## Encerramento26/10/2026

Tasks1–4 concluídas no escopo de [validação06C.1](../../validation/06-events-performance.md).273unitários e280integração verdes, build e tipos concluídos. Revisão independente com três P2 corrigidos, índice sob RLS comprovado com volume. Nenhum efeito externo de compra/envio; sessão QA encerrada e runtime retomado. Próximo06B.1. Migrações aplicadas são preservadas; correções posteriores estão em078/079.
