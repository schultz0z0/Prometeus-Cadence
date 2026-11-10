# 06B.6e / 06IA-H — Homologação real por módulo

**Estado em 10/11/2026: os três módulos executaram de ponta a ponta com fornecedores e IA reais, pelo worker contínuo. A qualidade ainda não sustenta o aceite: há três achados abertos abaixo.** Autorização permanente de gasto dada pelo operador em 10/11/2026.

## Como foi executado

Duas rodadas com `scripts/homologate-prospecting.mjs --confirm-provider-cost --limit=3`. O script cria uma conta `[RE]` descartável, entra no app com sessão real, chama os mesmos endpoints da interface (`/api/prospecting/prepare`, `/jobs`, `/apply`) e espera o worker contínuo processar a fila. No fim remove a conta por ID. A conta recebeu plano Essential por 7 dias, 12 extrações, 3 créditos de enriquecimento e um contexto aprovado de empresa (software, sites e automações com IA para PMEs). Recorte: Curitiba/PR.

O script antigo `scripts/smoke-prospecting-live.ts` não serve mais: usa uma sessão sintética que a verificação de sessão recusa com 401.

## Resultados

| Etapa | Rodada 1 | Rodada 2 |
| --- | --- | --- |
| Gerador · Maps ("clínica odontológica") | 3 inseridos em 26 s | 3 inseridos em 16 s |
| Gerador · Base CNPJ (CNAE 2512800) | 3 inseridos em 10 s | 3 inseridos em 5 s |
| Gerador · Busca na web ("escritório de contabilidade") | 3 inseridos em 21 s | 3 inseridos em 15 s |
| Qualificador · lista do Maps, 6 módulos | concluído em 101 s, 3 aplicados | concluído em 88 s, 3 aplicados |
| Enriquecedor · lista da Base CNPJ, 2 empresas | falhou em 51 s (`CHATGPT_REQUEST_FAILED`) | concluído em 98 s, 0 decisores, 0 cobrados |
| Enriquecedor · lista do Maps | sem lead com CNPJ | sem lead com CNPJ |

Campos por fonte, iguais nas duas rodadas: Maps entrega nome, telefone, site, cidade e endereço, sem CNPJ. Base CNPJ entrega nome, CNPJ, cidade e endereço, sem telefone e sem site. Busca na web entrega só nome e site.

Consumo por rodada: 9 extrações, 6 chamadas de IA no Qualificador e, na rodada 2, 2 chamadas de IA e 6 execuções Apify no Enriquecedor. Nenhuma reserva aberta no fim. Nenhum crédito de enriquecimento consumido. O app não registra o valor em dólar da Apify; foram 3 execuções no Gerador por rodada, mais 3 e 6 no Enriquecedor.

Qualificador, por lead: site já existia (`ALREADY_HAS_SITE`) em 6 de 6. Consulta cadastral sem CNPJ (`NO_CNPJ`) em 6 de 6. E-mail proposto em 1 de 6. Telefone proposto em 4 de 6. Aderência e resumo por IA propostos em 6 de 6, marcados como sugestão não calibrada para revisão humana.

## Defeito encontrado e corrigido

O pedido de decisores enviava um esquema JSON com campos opcionais (`email`, `phone`, `linkedin`). O modo estrito da OpenAI, usado tanto pela rota ChatGPT OAuth quanto pela API, recusa esse esquema com HTTP 400. Os testes usavam IA simulada e não exercitavam o esquema. Correção em `src/server/prospecting/ai/decisors.ts`: todos os campos obrigatórios, texto vazio quando o dado não existe e descarte dos vazios na leitura; contrato elevado para `decisors-public-evidence-v4`. Teste em `tests/enrichment-instructions.test.ts`.

## Achados abertos

1. **Busca na web traz páginas de resultado, não empresas.** Na rodada 1, dois dos três leads eram "Melhores empresas de Contabilidade em Curitiba" e "Mapa". Na rodada 2 os três eram sites de escritórios, mas com o título da página como nome ("Escritório de Contabilidade em Curitiba | (41) …"). A fonte precisa filtrar diretórios e extrair o nome da empresa.
2. **Maps → CNPJ: 0 de 6.** A consulta cadastral do Qualificador não achou CNPJ para nenhuma clínica vinda do Maps, embora todas tivessem site. Como o Enriquecedor só age em lead com CNPJ, nenhum lead do Maps chegou aos decisores.
3. **Base CNPJ traz MEIs.** Dois dos três eram microempreendedores individuais com nome de pessoa física. O Enriquecedor avaliou os dois e, corretamente, não entregou contato sem evidência. Falta medir o Enriquecedor numa empresa com sócios e presença pública.

## Limites desta prova

- Amostra de 3 leads por fonte, uma cidade, um nicho por fonte. Serve para provar execução, não rendimento.
- Nenhum decisor com contato foi entregue, então lista de pessoas, cobrança de 1 crédito e aplicação do resultado do Enriquecedor continuam sem prova real.
- Apollo não foi exercitado (sem chave com acesso à pesquisa).
- O motivo da abstenção do Enriquecedor não aparece no item; a empresa surge apenas como ignorada.
- A leitura de site pelo Chromium ocorreu dentro do Qualificador e do Enriquecedor, mas não foi inspecionada página a página nesta rodada.

Relatórios brutos, sem contatos pessoais: `output/homologation/06b6e-*.json`.
