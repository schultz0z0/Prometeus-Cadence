# 06C.2 — Dashboard e relatórios reconciliados

**Execução:** 28–29/10/2026. **Estado:** concluído no contrato local/controlado após uma revisão independente e uma passagem de correções. Não é aceite de produção pública nem de paridade integral com o CadenceFlow.

## Resultado implementado

Dashboard, relatórios geral/funil/performance e relatório da cadência consultam o mesmo serviço autorizado. Totais, séries e detalhe usam `app.report_facts`, mensagens únicas, publicações e etapas persistidas. Tentativas, respostas automáticas e DSNs não se tornam respostas humanas. Bounces e opt-outs continuam atribuídos quando há filtro de cadência. A atribuição é a última mensagem aceita anterior na conversa/identidade; bounce usa a mensagem correlacionada.

Períodos são instantes UTC absolutos, agrupados pelo fuso do workspace. O seletor personalizado agora transmite as datas escolhidas, incluindo o último dia local, em vez de descartar os valores. Mudanças de filtro retiram a leitura anterior; atualização automática preserva filtros e rascunhos. Falha de atualização identifica a última leitura e oferece recuperação.

Indicadores clicáveis abrem detalhe paginado, com a mesma base do total. A exportação JSON preserva `null` nas medições indisponíveis. Links de mensagens abrem a caixa do canal; não prometem selecionar uma conversa automaticamente. O histórico de execuções e o popup de ocorrências continuam usando seus serviços autoritativos existentes, sem outra fila ou cópia de resultados.

## Significado dos indicadores

| Indicador | Base e limite |
|---|---|
| Aceitas | Uma mensagem com aceite registrado pelo provedor no período; não soma tentativas. |
| Respostas | Mensagens humanas recebidas no período; e-mails automáticos, truncados e DSNs excluídos. |
| Falhas / fila / incertas | Estado atual da mensagem cujo instante operacional está no período. Incerteza não comprova falha nem autoriza repetir envio. |
| Bounce | Uma mensagem de saída correlacionada; DSNs repetidos não aumentam o total. |
| Opt-out | Uma identidade suprimida; hard bounce sozinho não é pedido de saída. |
| Leads / qualificados | Contatos criados no período e sua qualificação **atual**. Não inventa a data histórica da qualificação. |
| Inscritos | Contatos distintos em publicações criadas no período; pode incluir contatos captados antes. Não é a mesma coorte de criação dos leads. |
| Taxa de resposta | Identidades destinatárias com aceite no período que também responderam no período / identidades com aceite no período, por cadência. Denominador zero resulta em `null`. |
| Contadores atuais | Base, cadências, automações e publicações ativas identificados como estoque atual, separados da captação do período. |
| Abertura / clique / conexão / histórico da qualificação / consumo comercial consolidado | `null` / “—” enquanto não houver medição autoritativa correspondente. |

## Prova com histórico operacional real

Transação somente leitura sobre o workspace preexistente do operador; nenhuma chamada nova de Apify, LLM, e-mail ou WhatsApp. Consultas independentes das tabelas reconciliaram **3 aceites, 23 respostas humanas, 0 bounces, 0 opt-outs e 1 contato** com os fatos do relatório. A origem continha 22 e-mails humanos, 1 mensagem WhatsApp e 2 e-mails automáticos; estes dois ficaram fora do total humano.

[Curadoria sem dados pessoais](evidence/06c2-reconciled-reports/real-data-curation.json). Isso comprova a leitura do histórico persistido; não é um novo teste de entrega externa, nem valida a precisão de scraping/inferência.

## Testes e regressões

- Domínio: telemetria indisponível versus zero, métricas inválidas, divisão por zero, período absoluto/limitado, calendário inválido, dias de 23/25 horas e offset fixo. Data personalizada passou de função ausente para quatro testes verdes.
- Integração com PostgreSQL efêmero, papéis e isolamento reais: publicação, materialização, lease, dispatch, classificação de entrada e DSN correlacionado. Apenas o transporte externo foi substituído; não houve envio real pelo teste.
- Repetição e eventos atrasados, rebuild idempotente, cursor isolado, acesso HTTP anônimo/escopo divergente/input inválido, revogação de membro e escrita SQL de projeção proibida.
- 10 mil leads e 10 mil eventos repetidos: página de 50 itens, 12.587 bytes; 20 leituras aquecidas pelo handler HTTP autenticado. p95 observado nas rodadas: 84–176 ms; última focada após correção de canal: **93 ms**. Perfil local/controlado; não é SLO público ou ensaio de rede de produção.
- A suíte completa detectou `permission denied for function report_timestamp` em gravações normais de contatos. Os três casos de `contacts-base` falharam antes da migração corretiva089a e passaram depois. A função é um parser puro, sem leitura de tabela; o grant não permite escrever em projeções.
- O teste de opt-out de e-mail detectou canal `null` e destino incorreto;089b preserva o canal da conversa atribuída. Regressão 8/9 RED → 9/9 GREEN.
- O teste real de navegador detectou duas consultas do detalhe ao ocorrer polling da página principal. Após usar a identidade estável dos filtros, o mesmo teste comprovou uma consulta, mantendo o detalhe aberto durante a atualização. [Regressão](evidence/06c2-reconciled-reports/detail-polling.json).
- Verificação anterior à revisão final, já após089b: **430/430 integrações**, **355/355 unitários**, **9/9 focadas**, build de produção e tipos aprovados. O teste do popup também passou no build final. Resultados em [verification.json](evidence/06c2-reconciled-reports/verification.json).

## UI, referência e limites

**38 capturas mascaradas**, **32 verificações de rota/viewport** (incluindo8checks após a revisão), sem erro JavaScript de página e sem overflow horizontal nos casos observados. Rotas: dashboard, relatórios geral/funil/performance/CRM, execuções/lista/detalhe e relatório de cadência; desktop1920×855,390×844 e320×844. Exercitados: vazio real, histórico parcial persistido, popup de detalhe, período personalizado, datas mantidas durante17s de polling, falha de rede injetada no transporte e recuperação, ciclo deTab/Escape e download real com `null`.

[Verificações do navegador](evidence/06c2-reconciled-reports/browser-verification.json), [manifesto das capturas](evidence/06c2-reconciled-reports/screens-manifest.json), [funil desktop](evidence/06c2-reconciled-reports/screens/reports-funnel-1920.png), [detalhe320px](evidence/06c2-reconciled-reports/screens/funnel-detail-320.png).

Comparação com evidências históricas EV-219/227/229/250/254 e capturas pareadas da auditoria visual: cards, abas, filtros, painéis e estrutura responsiva preservados; controles de drilldown incorporados nos números para não acrescentar uma linha a cada card. Funil mantém painel inferior de qualificação ao lado dos dois painéis de conexões. Dados/estados distintos não constituem comparação pixel a pixel. Gráficos sem medição mostram indisponibilidade; os estados pagos/conectados da referência permanecem não observados, conforme decisão do operador. Não houve nova mutação da referência.

## Persistência e operação

Migrações089/089a/089b/089c aplicadas no banco local. Projeções derivadas com RLS forçada, revisão das fontes, checkpoint confirmado, cache de até128 consultas por workspace e reconstrução limitada a31dias por chamada. Histórico de negócio não é reescrito. O serviço/API restringe reconstrução explícita aowner/admin; membros atuais podem ler relatórios. O desvio deNULL na chamadaSQL direta fica documentado como menor em08A, sem ampliar acesso a dados.

O Docker apresentou erro1920 em sockets AF_UNIX ao iniciar pelo contexto do Codex. Diretórios efêmeros de IPC foram preservados com sufixo `.06c2-stale`; volumes, VHDX e configurações não foram apagados. O operador iniciou o Docker manualmente e o motor voltou. Nenhum reset ou mudança de segurança aplicada. Runtime local3210 e seis serviços contínuos conferidos saudáveis; confirmados novamente no fechamento (HTTP 200, seis serviços ativos, zero falhas).

## Cleanup

L018/L020/L021 restauradas; L019 removida. Um rascunho privado sem destinatários foi criado para abrir a aba de relatório e removido por ID exato, após confirmar zero publicações. Dados anteriores preservados, workspace restaurado, sessões da identidade QA dedicada revogadas e navegador próprio fechado. **Zero novos contatos, canais, mensagens, chamadas pagas ou envios externos.** [Prova](evidence/06c2-reconciled-reports/closure.json) e [rodada do detalhe](evidence/06c2-reconciled-reports/detail-closure.json), mais [pós-revisão](evidence/06c2-reconciled-reports/postreview-closure.json).

## Revisão final

Uma revisão independente encontrou dois Important: perda de microssegundos no cursor e cards dos canais abrindo a população geral. Ambos corrigidos em uma passagem, com regressões reais:50/120→120/120registros únicos e fixture de publicação/dispatch mista com2e-mails/1WhatsApp e respectivos detalhes. Migração089c mantém métricas específicas de canal sem duplicar o contador geral. [Revisão e dois menores adiados para08A](06c2-reconciled-reports-review.md). Verificação final: **355/355unitários,432/432integrações,11/11focadas**, build/tipos/diff aprovados,38capturas e32checks sem overflow/pageerror. p95HTTP aquecido de **106ms** no ensaio local de10mil leads/eventos, payload de12868bytes. Os dois menores permanecem em08A; não houve segunda revisão.

## Próximo pacote

Com o aceite local/controlado registrado: **06C.3 — notificações, preferências e resumos**. Os gates de piloto real de fontes/modelos e liberação pública continuam nos pacotes próprios.
