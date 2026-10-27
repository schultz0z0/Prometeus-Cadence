# Revisão final 06B.3

Revisão independente, somente leitura, por `gpt-6-astra`, base `851b4f6`, entrega `4d07cd0`. Nenhum achado crítico; cinco importantes e um menor. Uma única rodada de correção com regressões RED→GREEN; sem redistribuir revisão. Verificação completa após correções: 319/319 unitários e 337/337 integrações, build/tipos e regressão de browser aprovados.

| Achado | Correção e prova |
|---|---|
| P1: cancelamento/reconciliação perdiam a incerteza | Guard de tentativas preparadas/incertas antes do cancelamento. `resultUnavailable` termina a pesquisa como failed/partial e projeta empresas sem resultado como indisponíveis. Checkpoints de falha conhecida não são repetidos nem entram em reconciliação sem tentativa selecionável. Regressões de cancelamento/reconciliação e checkpoint falharam antes e passaram após a correção. |
| P2: elegibilidade podia expirar durante a última coleta | Permissão atual e elegibilidade de execução revalidadas antes da publicação; triggers de fonte/fato/caso repetem a elegibilidade no SQL. Receipt já recebido é preservado. Regressão pós-I/O mostrou fatos antes da correção e zero depois; INSERT SQL direto também recusado. |
| P2: link da agência virava perfil da empresa | Link social descoberto permanece incerto até corroboração do perfil. Página vinculada e prova de corroboração ficam citadas. Regressão com link “Site desenvolvido por Agência” RED→GREEN. |
| P2: aplicação do site invalidava o restante | A base efetiva aceita valores já aplicados pelo mesmo caso, mantendo a base original imutável; edição humana divergente continua bloqueada no serviço e SQL. Site→e-mail passa sem recolher; edição posterior do site bloqueia o telefone. |
| P2: perfil usado como site perdia seu caminho | Origens compartilhadas preservam o URL com o caminho do perfil. Regressão Instagram RED→GREEN. |

As correções SQL estão em `083a-company-research-review.sql`, posterior a083 sem reescrever seu checksum e sem ocupar084 reservado ao próximo pacote. O migrador usa nomes completos ordenados e a aplicação local foi verificada.

Menor adiado: o link do detalhe inclui `?leadId`, mas um lote abre a primeira empresa; o seletor com os nomes permite escolher a correta. Não invalida o isolamento nem a revisão dos campos, mas merece ajuste de navegação futuro.

## Limites que o revisor não julgou como parte desta entrega

- Identidade aprofundada, pessoas e contatos pessoais:06B.4; antecipar isso ampliaria a implementação sem seus contratos de identificação.
- Orquestração automática de cadências:06B.5; pesquisa não deve ativar mensagens.
- Actors sociais novos/autenticados: gate central de contrato/custo/acesso; ativação prematura afirmaria cobertura não demonstrada.
- Acurácia, custo real e cobertura empírica:06IA-H; fixtures não substituem piloto.
- Deploy, carga e restore públicos:08B; localhost não é certificado de produção.
- Paridade exata de estados inacessíveis da referência: não observada; não atribuir a implementação própria ao backend original.

Decisão do implementador: manter esses seis limites nos donos já aprovados, com a ressalva correspondente no relatório. Nenhum requisito foi silenciosamente declarado pronto.
