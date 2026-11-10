# 06B.6e — Piloto da Prospecção completa

Em 09/11/2026, a autorização do operador cobriu um piloto de um lead, com o código do worker e o gateway local. A conta `[RE]`, a lista e o processamento ficaram em Postgres efêmero, isolados da fila contínua. A execução passou pelos handlers de revisão e confirmação do aplicativo. O recorte foi o CNAE 2512800, em Curitiba/PR, com as duas faixas de abertura habilitadas.

## Rodada com fornecedores reais

O primeiro teste fez a consulta cadastral e recebeu HTTP 400 ao iniciar o Maps. O teto enviado era de US$ 0,05. A configuração vigente do Actor exige US$ 0,50 como valor mínimo aceito para o teto por execução. A configuração do runtime já atendia a esse mínimo. [Contrato da Apify](https://docs.apify.com/api/v2/actors-runs-post)

A segunda rodada usou teto de US$ 0,05 por consulta cadastral e US$ 0,50 por execução de Maps ou Search. O teste verificou o saldo do limite total de US$ 0,60 entre as chamadas. Começou com duas execuções de CNPJ, nove de Maps e uma de Search. O teste reaproveitou os mesmos datasets e fez uma última consulta de Maps para o décimo candidato. A Apify informou US$ 0,08255 na rodada completa, incluindo a última chamada, e US$ 0,023 no teste que parou no HTTP 400. Total de US$ 0,10555.

| Medida | Resultado |
| --- | --- |
| Ordem observada | CNPJ da faixa a partir de 2020, Maps por candidato, CNPJ da faixa até 2019, Maps por candidato e Search para a empresa sem site informado |
| Empresas avaliadas | 10 |
| Identidade no Maps sem confirmação | 9 |
| Identidade no Maps confirmada, site sem verificação | 1 |
| Inseridas | 0 |
| Encerramento | `partial` com `VERIFIED_DISCOVERY_SHORTFALL` |
| Extrações consumidas e reservas finais | 0 consumidas, 0 retidas |

No recorte, o Maps omitiu telefone no resultado com nome semelhante e endereço diferente. A única empresa com correspondência inequívoca no Maps tinha telefone, mas o Maps não forneceu site institucional. A busca retornou dois candidatos a site. O coletor encontrou bloqueio por `robots.txt` e um erro de disponibilidade nos destinos investigados. Não houve página renderizada com texto que pudesse comprovar a identidade dessa empresa.

## Admissão com fontes cadastral e Maps reaproveitadas

Uma empresa já presente nos datasets de CNPJ e Maps tinha identidade confirmada e site institucional. O teste derivou o município e o CNAE desses registros e usou um recorte separado. O worker recebeu os dois registros reais como respostas em memória, com a primeira faixa vazia. O gateway Scrapling com Chromium leu o site público ao vivo. Esse cenário verificou a admissão com dados reais de uma empresa conhecida, sem nova execução paga.

- A descoberta concluiu com uma empresa inserida como pendente. O mesmo lead recebeu uma evidência cadastral, uma do Maps e duas do site lido pelo Chromium.
- A fila encerrou 29 URLs de página como concluídas, nove com texto armazenado. Duas URLs retornaram HTTP 404 e uma ultrapassou o limite de tamanho. O `robots.txt` e o sitemap terminaram como concluídos.
- A reserva comercial fechou com uma extração liquidada no banco de prova e zero retidas. As reservas técnicas da Apify também terminaram em zero. A remoção por ID e a exclusão do catálogo de prova deixaram resíduo zero.

O gateway autenticado também renderizou uma página pública da IANA com HTTP 200 e texto. [Página renderizada](https://www.iana.org/help/example-domains)

## Limites da prova

O piloto rodou no processo de teste com a função `runWorkerOnce` e as políticas reais do banco, enquanto a lane contínua permaneceu em seu ambiente compartilhado. O escopo foi a descoberta até a admissão, anterior à investigação adicional, qualificação por IA e mensagens. Falta observar uma admissão em busca nova na lane contínua. O histórico dos Actors ficou na Apify. O Prometeus conservou apenas contagens e resultados agregados.

## Regressão e revisão

Os 462 unitários, as 49 integrações selecionadas, o build e a checagem de tipos passaram. A repetição controlada inseriu 250 empresas simuladas após quatro descartes, em 555 turnos e cerca de 9 min 31 s. A jornada `pack` no Chrome confirmou os recortes e o navegador disponível, com resíduo zero. O auditor global registra 8/138 no hash atual. Esse total mantém o 08A em aberto. A checagem da base manteve os quatro erros históricos de `clone/barriers.md`.

A revisão independente verificou que o código de saída do script, por si só, também permite falha ou resultado parcial. A prova de admissão exige estado concluído, lead pendente, evidências vinculadas e reservas encerradas. [Revisão independente](06b6e-prospecting-live-pilot-review.md)
