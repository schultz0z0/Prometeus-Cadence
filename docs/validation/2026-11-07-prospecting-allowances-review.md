# Revisão das franquias e da Prospecção completa

Revisão independente, somente leitura, em 07/11/2026. A segunda leitura conferiu os quatro achados iniciais e identificou uma corrida entre o cancelamento e o próximo lote do Maps.

| Achado | Correção e prova |
| --- | --- |
| O banco ignorava a política operacional em workspaces pagos. | A reserva aplica o menor teto entre plano e política. O teste confirmou a recusa após consumir a política de duas chamadas. |
| A capacidade de 40 execuções Apify por vaga diária não cobria as buscas unitárias das duas modalidades. | O modelo passou a 52 por vaga. O teste lança consumo agregado equivalente a 500 buscas unitárias no Essential e a 800 no Pro, com as etapas seguintes. |
| Um estabelecimento encerrado no Maps ainda passava pela admissão. | O adaptador conserva a indicação de encerramento permanente. A admissão descarta esse candidato antes da consulta cadastral. |
| A etapa de pessoas podia abrir a raiz do LinkedIn ao receber um resultado indexado. | O coletor recusa o domínio. O teste mantém a fonte indexada e verifica as URLs entregues ao coletor. |
| O segundo lote podia sobrescrever um cancelamento concorrente. | A transição só atualiza jobs em execução ou aguardando provedor. O teste simula o cancelamento no limite da transação de ingestão e comprova que o segundo lote não começa. |

A execução completa também revelou competição indevida entre os orçamentos de trial e de assinaturas pagas. A reserva global agora separa esses grupos, com teste cobrindo uso do trial após consumo integral do plano. Um teste de admissão com crawler confirmou que a ficha do Maps precisa ser guardada junto com a página do CNPJ e o registro cadastral. A ingestão passou a preservar as quatro fontes delimitadas da admissão.

A prova de capacidade usa unidades agregadas no banco. O teste real do crawler verifica o contrato de uma página. A capacidade sustentada dos fornecedores, a taxa de admissão e o custo por empresa verificada dependem de uma rodada de produção controlada. As diferenças em relação ao CadenceFlow permanecem descritas no plano e no relatório.
