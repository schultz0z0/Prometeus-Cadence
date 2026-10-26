# 06C.1 — eventos e desempenho

26/10/2026. Implementação na branch `codex/events-performance-06c1`, derivada de `8e71f0a`. O trabalho anterior até06A-H foi integrado e enviado para a `main` do GitHub nesse commit, conforme solicitado. [Plano06C.1](../superpowers/plans/2026-10-26-prometeus-cadence-06c1-events-performance.md).

## Entrega

- Histórico incremental de mudanças reais de jobs, automações em execução, conexões/remetentes, caixas, mensagens/outbox e conta financeira. Eventos são gravados na mesma transação, no commit; rollback não publica mudanças. Replay/no-op/freshness isolada não cria atividade falsa.
- `GET /api/operations/events`, autenticado e isolado por workspace, com cursor exclusivo e páginas de1–100 eventos (padrão50). A cabeça por workspace ordena commits, sem perder uma transação que termine depois de outra. A gravação é adiada até o commit para não manter esse bloqueio durante o trabalho de negócio.
- Metadados mínimos: tipo, identificador interno, estado, revisão e horário de registro. Sem texto, corpo de e-mail, telefone, destinatário, credencial ou payload de provedor. App/workers não têm autorização para inserir eventos diretamente; o trigger registra apenas efeitos das operações já autorizadas nas tabelas de origem. Leitura verifica sessão e associação atuais, inclusive em pedidos condicionais/incrementais.
- Métricas delimitam timestamps absolutos antes de agregar por dia/fuso. A API informa `period.timezone/from/to`, com começo inclusivo/fim exclusivo. GMT, fusos IANA e offsets ISO válidos são preservados; o sinal de offset ISO é convertido para a convenção POSIX usada pelo PostgreSQL.
- Timestamp derivado e armazenado `channel_message.metric_at`, com índice por workspace/período. O teste de volume demonstrou que o índice anterior de expressão `COALESCE` não era utilizado sob RLS; a coluna derivada permite o filtro indexado sem relaxar o isolamento. Migrações076–079 aplicadas localmente, sem alterar checksums já aplicados.
- GETs simultâneos idênticos compartilham uma chamada somente na mesma instância/workspace. POSTs continuam independentes e revisados. Leituras anteriores ou iniciadas durante uma mutação são invalidadas quando o POST começa/termina; uma resposta atrasada não substitui a recarga posterior.
- GET travado expira após15s e libera o slot para retry. Disposal/revogação aborta a leitura e impede publicar dados do workspace anterior. Refreshes do snapshot também são coalescidos; um snapshot externo conflitante não substitui a base de um formulário em edição e novas gravações cegas são bloqueadas.
- Polling existente de15s, backoff até60s, pausa por aba oculta/rede e descarte continua compartilhado pelos módulos. Não foi adicionado broker, dependência ou outro serviço.

## Contratos para os próximos consumidores

| Campo/medição | Significado |
|---|---|
| `sequence` | String numérica monotônica por workspace, atribuída ao publicar o commit. Usar para paginação, não a revisão da entidade. |
| `revision` | Revisão da fonte quando existe. Pode permanecer igual em uma renovação financeira; a sequência continua mudando. |
| `recordedAt` | Horário de registro do journal, não uma alegação de horário de entrega/leitura no provedor. |
| `state` | Estado operacional da fonte declarada em `kind`. Não traduz `ready` em mensagem entregue. |
| `nextCursor` | Cursor opaco retomável inclusive em página vazia. Vinculado ao workspace; não concede autorização. `hasMore` indica outra página no recorte lido. |
| Enviado/aceito | Outbox com aceitação persistida. Não prova entrega ao destinatário. |
| Resposta | Entrada WhatsApp ou e-mail classificado como humano; automáticos/DSN/ambíguos não são resposta humana. |
| Falha/pendência | Estado persistido da mensagem no período de referência. Não são somas de tentativas de envio. |
| Abertura/clique | `null`, pois ainda não são medidos por esta integração. Zero não substitui indisponibilidade. |

O journal começa na migração: não inventa transições históricas para registros que já existiam. As tabelas de origem continuam autoritativas para métricas e conteúdo; esse feed não substitui receipts autenticados, o ledger financeiro ou trilhas de exclusão. Históricos/projeções visuais/novos consumidores ficam06C.2/3 e os eventos específicos ainda não implementados acompanham06B/06D. Exclusão/retenção do journal pertence ao ciclo de dados06E.2/08B.

## Medições e alcance

Orçamento declarado após baseline: APIs locais aquecidas p95≤250ms, navegação completa≤1500ms, cinco solicitações concorrentes sem erro; feed100itens≤100KB. Não é SLO de produção nem de internet móvel.

| Conferência | Resultado |
|---|---|
| Baseline, workspace pequeno do operador, somente leitura | Navegação182–330ms; APIs12–52ms; cinco snapshots65–71ms. |
| Build final, workspace QA pequeno | Navegação122–324ms; p95 snapshot49ms, métricas28ms, billing23ms, feed15ms. Cinco snapshots concorrentes33–37ms, todos200. |
|10.000 transições no banco isolado `_test` | Página100 com15.928bytes; leitura+plano de consulta11ms na medição focada; índice de cursor confirmado. |
|10.000 mensagens históricas no banco isolado `_test` | Recorte atual retornou362bytes; leitura+EXPLAIN12ms na medição focada; índice de período confirmado pelo papel da aplicação sob RLS. |
| Atualização e rede no navegador | Alteração externa não apagou nome em edição; configuração QA restaurada.17s offline sem novos snapshots; retomada ao conectar preservou o texto. |
| Interface | Desktop1920×1080 e mobile390×844; nenhum erro JavaScript e mobile sem overflow horizontal. Não houve mudança de CSS/geometria neste marco. |

Os workspaces de baseline e pós-entrega têm volumes diferentes (snapshot1.809 versus825bytes). **Não é uma comparação controlada nem prova de ganho percentual.** O que foi comprovado é o orçamento declarado e a remoção dos padrões de custo/concorrência testados. O snapshot legado de autoria permanece completo, sem truncamento silencioso; consultas próprias de contatos/consumidores e projeções maiores continuam nos pacotes06B/06C.2. Estes números não certificam uma base inteira de100mil leads.

[Medições sanitizadas](evidence/06c1/performance.json), [desktop](evidence/06c1/1920-dashboard.png) e [mobile](evidence/06c1/390-account.png). RES reutilizado para mascarar as capturas. Estados privados/pagos da referência continuam não observados conforme a decisão anterior; não se declara paridade visual100% desses estados.

## Verificação e revisão

- Unitários finais:273/273, incluindo deadline real de15s e liberação para retry, coalescing, falhas, POST/GET concorrentes, disposal, revisão e rascunhos. `.runtime/06c1-unit-final.log`.
- Regressão integral de aceite: **280/280**, zero falhas, em `.runtime/06c1-accepted-integration.log`, após correções e teste de volume. O recorte adicional de métricas passou3/3 e o scheduler8/8.
- Build final concluído e TypeScript posterior sem erros. `git diff --check` sem erros.
- Revisão independente única: três P2 reproduzidos e corrigidos com regressões RED→GREEN (GET durante POST, fuso aceito no cadastro e renovação ativa sem aumento de revisão). Sem P1. O achado posterior de índice/RLS veio da medição de volume e recebeu regressão específica.
- Na primeira regressão com079,279/280 passaram e um teste de scheduler falhou ao comparar diretamente relógio Windows versus PostgreSQL;8/8 passaram na repetição isolada. A âncora passou a ser o próprio relógio do banco, acrescida da igualdade exata com `started_at` do job reivindicado. Nenhum relógio, tolerância arbitrária ou comportamento do scheduler foi alterado. A suíte integral de aceite é executada novamente após esse ajuste.
- Nenhuma compra, ativação de trial, envio ou alteração no workspace do operador. QA reutilizou identidade/workspace fictícios existentes; a edição persistida temporária foi restaurada. Os bancos de volume são efêmeros e removidos pelo runner.
- [Encerramento QA](evidence/06c1/closure.json): uma sessão revogada, assinatura original preservada, migrações locais conferidas e smoke dos limites/escopo/autenticação. Aplicativo e seis lanes retomados com processos ocultos.

**06C.1 concluído no escopo acima.** Próximo pacote: **06B.1 — contatos, importação, busca e execução até resultado persistido**, seguindo a sequência aprovada. Nenhuma etapa manual necessária para este aceite local.
