# Marco 03 — revisão e correções

Revisão independente única da implementação `a97d784..4874f375e03cced63e4dbf234b712a7b2162f128`, conforme execução nativa aprovada. Nenhum achado crítico; oito importantes aceitos pela consequência para o usuário e um menor adiado. Correções pelo implementador em um único passe com regressões observadas falhando antes da implementação e passando depois. Sem segunda revisão.

| Achado importante | Correção e regressão RED → GREEN |
|---|---|
| Retomada após último recibo voltava à página zero | Checkpoint esgotado/limite alcançado finaliza o job; integração cobre Maps e Apollo sem nova leitura. |
| Apollo mudava tamanho da página no limite 150 | `per_page` permanece estável; a última página aceita somente o saldo. Teste verifica IDs sem repetição e contagens buscada/aceita distintas. |
| Chamadas de qualificação incertas não tinham resolução completa | Reconciliação por operação: vincular run Apify correspondente, confirmar ausência ou registrar consumo com resultado indisponível. Integração cobre website e inferência, acesso administrativo e ausência de segunda chamada. |
| Cancelar qualificação liberava reserva de chamada desconhecida | Cancelamento conserva a reserva e exige reconciliação antes de finalizar. Integração cobre tentativa incerta e vínculo posterior ao run específico. |
| POST bem-sucedido com resposta inutilizável era tratado como falha definitiva | Corpo vazio/excessivo, run inválido e decisão inválida preservam estado incerto. Testes verificam que não há retry automático do POST. Falhas de resultado do CLI após execução também são incertas. |
| Alta confiança com qualidade/cobertura zero sugeria qualificado | Ausência de qualidade suficiente ou cobertura integral mantém pendente; não converte confiança em acurácia. Regressão cobre decisão confiante sem evidência utilizável. |
| Redirect canônico para `www` descartava evidências | Mesmo domínio normalizado aceita apex/`www`, com validação SSRF em cada salto preservada. Teste cobre redirect canônico. |
| Normalização e propostas perdiam proveniência factual | Resultados Apify retêm fatos/snippets limitados, fonte/data/hash; propostas website/registry persistem seus IDs de evidência. Teste do adapter e integração verificam conteúdo/fonte e vínculo. |

Suíte após correções: **71/71 unitários, 39/39 integração PostgreSQL, typecheck e build webpack exit0**. Asserções de provedores usam fixtures privadas; não comprovam uma busca ou inferência paga real. Evidência final de navegador e rotas em `03-prospecting.md` e `routes-03.json`.

## Menor adiado

Histórico de execuções tem paginação/atualização, mas ainda não possui filtros por tipo, estado e fonte. Não compromete isolamento nem execução; aumenta o trabalho para localizar um job em históricos extensos.

## Questões que a revisão não julgou

Cada ponto recebeu uma decisão explícita, preservada no registro de execução com justificativa e custo: elegibilidade/saldo/preço real dos provedores; precisão empírica/calibração JEV; inferência efetiva e supressão de ferramentas no CLI; deploy público; estornos; completude nacional CNPJ/people/CRM; scheduler/canais/billing; throughput e crescimento do ledger; arquivos de screenshot recusados pela política do MCP; paridade de desempenho entre bundlers.

O resultado entregue é uma implementação local de contratos e fluxos revisáveis. Os itens dependentes de credenciais, crédito, amostra humana ou infraestrutura pública continuam pendentes e não foram convertidos em alegações de sucesso.
