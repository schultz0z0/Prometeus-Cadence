# 06B.6e / 06IA-H — Homologação real por módulo

**Estado em 10/11/2026: os três módulos executaram de ponta a ponta com fornecedores e IA reais, pelo worker contínuo. A descoberta de CNPJ para leads do Maps subiu de 0 em 6 para 3 em 5 depois da correção descrita abaixo. Continuam abertos a Busca na web e a entrega real de um decisor com contato.** Autorização permanente de gasto dada pelo operador em 10/11/2026.

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

## Descoberta de CNPJ para leads do Maps

Nas duas primeiras rodadas a consulta cadastral só procurava o CNPJ no site do próprio lead e não achou nenhum (0 de 6). A correção, em `src/server/prospecting/qualification.ts`:

1. Quando o site não publica CNPJ, o módulo faz uma busca pública por `"nome comercial" cidade CNPJ`, usando o nome sem o complemento do Maps ("| Implantes", "- Dentista 24h").
2. Dos resultados que citam a empresa, toma até dois CNPJs candidatos.
3. Consulta cada candidato na Base CNPJ e só aceita o que confirma a mesma cidade e, além dela, o nome, o telefone ou o CEP do lead.
4. Com exatamente um confirmado, propõe o CNPJ para revisão. Com nenhum, abstém-se com `CNPJ_NOT_CORROBORATED`; com dois, `AMBIGUOUS_CNPJ`.

A conferência na Receita é necessária: numa rodada, o único CNPJ do resultado era o do próprio diretório que listava a clínica, com sede no Rio de Janeiro, e foi recusado pela cidade.

| Rodada (5 leads do Maps, Curitiba) | CNPJ proposto | Como |
| --- | --- | --- |
| Busca restrita a diretórios cadastrais, um candidato | 1 de 5 | CNPJ publicado no site do lead |
| Busca geral, até dois candidatos conferidos | 3 de 5 | 1 pelo site, 2 pela busca com confirmação na Receita |

Na última rodada o Qualificador usou 9 execuções Apify e 10 chamadas de IA para 5 leads, em 258 s. A estimativa da revisão passou a reservar até 3 execuções por lead no módulo cadastral. Dois dos leads com CNPJ seguiram para o Enriquecedor, que concluiu sem decisor com contato atribuível e sem cobrança.

A tela de resultados passou a mostrar módulo, estado e motivo em português, em vez dos códigos internos.

## Diagnóstico do Enriquecedor

Uma rodada com registro temporário (contatos mascarados) mostrou o que a IA recebia e propunha:

- **Empresas da Base CNPJ, sem site:** a evidência foi o próprio registro cadastral e páginas genéricas (Serasa, Google). A IA não propôs ninguém. Os nomes dos sócios vinham do cadastro, mas sem nenhum contato.
- **Clínica com site próprio que publica o CNPJ (Prodont):** a leitura do site trouxe início, "sobre" e contato. O Enriquecedor, porém, gravava no máximo 3 evidências e descartava a página de contato antes da IA. **Corrigido:** todas as páginas coletadas chegam à IA; teste em `tests/integration/enrichment.test.ts`. Na rodada de confirmação chegaram 4 evidências, incluindo `/contato/`.
- **Mesmo com todas as páginas, nenhum decisor foi proposto.** A regra vigente só entrega pessoa com contato pessoal publicado e atribuído por citação literal, e o site da clínica não publica contato de sócio. O validador rígido não chegou a recusar nenhuma proposta nas rodadas observadas: a IA se absteve antes.

Conclusão: com fontes públicas e a regra atual, o Enriquecedor tende a zero entregas em pequenas empresas. Isso é limite de produto e de fonte de dados, não de código.

## Decisores sem contato publicado

Decisão do operador em 10/11/2026: o Enriquecedor registra na ficha da empresa os decisores encontrados no cadastro, mesmo sem contato publicado. São os sócios do QSA ou, no MEI, o titular, cujo nome vem na própria razão social.

- Sem contato pessoal não há cobrança de crédito, e a pessoa não entra na lista de decisores usada em cadências. Só entra quem tem e-mail ou telefone publicado e atribuído.
- O filtro "contato enriquecido" da lista de contatos continua contando só quem tem contato.
- A regra vale na tela, no servidor e no banco (migração `115-enrichment-contactless-partners.sql`, para cobrança e aplicação).
- A ficha do lead e a tela de resultados indicam "sem contato pessoal publicado, nome e cargo do cadastro da empresa".

Rodada real de confirmação: 4 empresas, 3 com decisores registrados (1 titular de MEI, 2 empresas com dois sócios cada), 0 créditos cobrados, nenhuma reserva aberta. Uma limitada não trouxe QSA na fonte cadastral.

## Busca na web

A geração pela Busca na web passou a admitir só o site próprio de uma empresa (`src/server/prospecting/web-results.ts`). Ficam de fora buscadores, redes sociais, diretórios e agregadores, além de títulos de lista ("Melhores…", "Top 10…", "Empresas de…"). Os descartes aparecem como "Resultado de lista, diretório ou rede social, não site de empresa". O nome do lead passa a ser o trecho do título que corresponde ao domínio, e um telefone no título vira o telefone do lead. A lista de plataformas é a mesma usada pelo Qualificador para recusar sites que não são institucionais.

Rodada real (5 resultados, "escritório de contabilidade", Curitiba): 4 leads com site próprio e 1 descarte. Dois nomes saíram limpos ("FALAVINHA NEXT", "Kitron Contábil"). Em dois casos o título não tinha trecho correspondente ao domínio e o nome ficou genérico ("Escritório de Contabilidade em Curitiba", "CONTABILIDADE CURITIBA"). Um descarte não é reposto na mesma execução, então a busca pode entregar menos que o pedido.

## Apollo com plano gratuito

Com a chave do operador, a busca Apollo do app recebeu HTTP 403: o plano gratuito bloqueia `mixed_companies/search`. O adaptador passou a tentar `organizations/search`, liberado no plano, com os mesmos filtros, apenas quando a primeira recusa com 403. Rodada real no workspace do operador: 1 empresa inserida em 4 s, com site e cidade. O plano gratuito não dá acesso a busca nem enriquecimento de pessoas.

## Leitor de sites

Em 12 leituras de 6 sites reais, o resultado se repetiu em cada site; o caso da Prodont vazia não foi reproduzido. Sites sem `/sobre` e `/contato` ficam só com a página inicial. Quando o `robots.txt` não pode ser lido, o site é tratado como fechado.

## LinkedIn dos sócios

Decisão do operador em 10/11/2026: o Enriquecedor pesquisa no Google o perfil de até dois sócios e lê os perfis encontrados com o raspador `harvestapi/linkedin-profile-scraper`, sem cookies. Um perfil só é aceito quando o nome bate com o sócio do cadastro e a empresa atual bate com a do lead; o e-mail aparece como encontrado pelo fornecedor. O raspador não devolve telefone. [Avaliação e riscos](2026-11-10-linkedin-scrapers-evaluation.md)

Rodadas reais:

- **Clínicas e MEIs (Base CNPJ e Maps):** nenhum perfil encontrado. A primeira versão pesquisava o nome completo do cadastro entre aspas, que nunca bate com o nome exibido no LinkedIn. Passou a usar primeiro e último nome.
- **Empresas de software de Curitiba (CNAE 6201-5/01):** a leitura dos perfis estourava o prazo de 30 s do transporte comum e travava a execução em reconciliação. Corrigido: prazo próprio de até 125 s e, se falhar, o Enriquecedor segue sem perfis. Na repetição, as 3 empresas foram processadas. Uma teve dois perfis homônimos lidos e corretamente descartados (outra empresa e empresa não informada); as outras duas não tinham perfil encontrável. Nenhum e-mail.

Conclusão: a fonte funciona e protege contra homônimos, mas o rendimento em pequenas empresas de Curitiba foi zero nas amostras. O custo foi baixo: uma leitura de dois perfis e as pesquisas no Google.

## Achados abertos

1. **Busca na web (corrigida, ver acima).** Antes: Na rodada 1, dois dos três leads eram "Melhores empresas de Contabilidade em Curitiba" e "Mapa". Na rodada 2 os três eram sites de escritórios, mas com o título da página como nome ("Escritório de Contabilidade em Curitiba | (41) …"). A fonte precisa filtrar diretórios e extrair o nome da empresa.
2. **Maps → CNPJ: 3 de 5 após a correção.** Amostra pequena, um nicho e uma cidade. Dois de cinco continuam sem CNPJ e, portanto, fora do Enriquecedor.
3. **Nenhum decisor com contato entregue.** Os decisores passaram a ser registrados sem contato, mas nenhuma rodada encontrou contato pessoal publicado; obter celular ou e-mail de sócio exigiria um provedor pago de dados de pessoas, que não foi avaliado. Em cinco execuções do Enriquecedor, com MEIs da Base CNPJ e clínicas do Maps, o resultado foi sempre abstenção sem cobrança. A regra exige contato pessoal atribuído por citação literal; falta um caso real em que ela seja satisfeita.

## Limites desta prova

- Amostra de 3 leads por fonte, uma cidade, um nicho por fonte. Serve para provar execução, não rendimento.
- Nenhum decisor com contato foi entregue, então lista de pessoas, cobrança de 1 crédito e aplicação do resultado do Enriquecedor continuam sem prova real.
- Apollo não foi exercitado (sem chave com acesso à pesquisa).
- O motivo da abstenção do Enriquecedor não aparece no item; a empresa surge apenas como ignorada.
- A leitura de site pelo Chromium ocorreu dentro do Qualificador e do Enriquecedor, mas não foi inspecionada página a página nesta rodada.

Relatórios brutos, sem contatos pessoais: `output/homologation/06b6e-*.json`.
