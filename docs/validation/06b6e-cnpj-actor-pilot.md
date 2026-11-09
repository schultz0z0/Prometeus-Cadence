# 06B.6e — Piloto do Actor de CNPJ

Em 09/11/2026, o operador autorizou duas consultas ao build cadastral configurado na Apify. Ambas usaram CNAE principal 2512800, Curitiba/PR, situação ativa, um cadastro por faixa e teto de US$ 0,05 por run. O corpo foi montado pelo mesmo adaptador do aplicativo. O reinício automático ficou desabilitado.

| Faixa | Resultado | Uso informado pela Apify |
| --- | --- | --- |
| A partir de 01/01/2020 | Um cadastro com data, CNAE, município, UF e situação válidos | US$ 0,008, com um evento de início e um de cadastro |
| Até 31/12/2019, primeira consulta | Nenhum cadastro. Uma linha de erro | US$ 0,000, com zero eventos cobrados |
| Até 31/12/2019, nova consulta autorizada | Um cadastro com data, CNAE, município, UF e situação válidos | US$ 0,008, com um evento de início e um de cadastro |

A primeira consulta da faixa antiga terminou tecnicamente em `SUCCEEDED`, mas seu dataset registrou HTTP 429 da Minha Receita. O prazo de retentativa informado foi de 60 s, acima do tempo que o Actor aceitou esperar. Com nova autorização, somente essa faixa foi consultada, com os mesmos filtros e limites. O retorno incluiu um cadastro válido e zero linhas de erro. A conferência dos datasets existentes confirmou CNPJs distintos entre as faixas. O total informado para as três execuções foi US$ 0,016.

A conferência ocorreu em memória, com apenas agregados no Prometeus. A Apify mantém o histórico das três execuções. O resultado confirma os filtros neste recorte e neste build, com uma amostra válida em cada faixa. A homologação ponta a ponta com o worker e Chromium continua separada.

[Contrato dos filtros](https://apify.com/bigdavidson/brazil-cnpj-companies/input-schema) · [Limite por execução](https://docs.apify.com/api/v2/actors-runs-post)
