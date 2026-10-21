# CNPJ local e coleta Web — estudo para o próximo ajuste de arquitetura

Data: 21/10/2026. Estado: investigação e proposta; não é uma integração implementada. Base do aplicativo: main `0b48b4c`. Pedido: reduzir custos de CNPJ/CNAE e Web, reaproveitar o pipeline indicado sem recriá-lo e preparar conexões antes do piloto pago. Execução nativa nesta conversa.

## Decisão após a orientação mais recente do usuário

O usuário esclareceu: se não houver comprovação de que atende integralmente, manter Apify. Portanto, **não substituir CNPJ/CNAE agora**. O catálogo local fica como candidato posterior; licença, carga nacional, publicação consistente e dimensionamento não estão resolvidos. O Apify continua como caminho de integração planejado, sujeito a correção do seu contrato e piloto real. Isso não significa que o Actor atual já tenha sido validado em produção.

## Conclusão técnica

Uma base compartilhada da Receita em PostgreSQL é tecnicamente adequada para substituir o Actor CNPJ. A operação mensal e o armazenamento passam a ser nossos custos, em lugar de uma chamada paga por consulta. O pipeline indicado é um candidato concreto, com ressalva de licença ainda não identificada e sem benchmark nacional executado nesta investigação.

Para Web, separar descoberta de empresas de leitura de sites. Manter Apify para Google Maps/SERP; ler os sites por HTTP e usar um worker com navegador apenas quando necessário. A LLM convencional interpreta evidências e pode orientar casos excepcionais; o JEV classifica/ordena decisões. Não tornar cada clique uma inferência. Firecrawl e Website Content Crawler são alternativas, não dependências que precisem ser todas instaladas.

## O que foi observado no repositório indicado

- Fonte: https://github.com/caiopizzol/cnpj-data-pipeline
- Commit examinado: `f50632bae93b37abf26d01226433347c047d017f`, release `1.38.10`.
- Clone de investigação fora do aplicativo: `C:/Users/rapha/AppData/Local/Temp/prometeus-cnpj-review-20261021`.
- Python, requests, Polars e psycopg2; PostgreSQL por padrão, Parquet opcional. CSVs sem cabeçalho, separados por ponto e vírgula, convertidos de ISO-8859-1 para UTF-8.
- Listagem e downloads via WebDAV do repositório Nextcloud oficial da Receita. Suporta retomada `.part`, concorrência de download adaptativa, validação de layout, COPY para tabela temporária e UPSERT.
- Tabelas de empresas, estabelecimentos, sócios, Simples e dicionários. Índices por CNAE/UF/município/situação. Receitas SQL opcionais para detalhe de empresa, busca por nome, CNAEs secundários e contagens.
- CNPJ básico/ordem são strings compatíveis com o formato alfanumérico. Não converter CNPJ em número. O normalizador atual do Prometeus já preserva letras e zeros.
- Cada comando executa uma vez e termina. Atualização automática exige nosso agendamento. `processed_files` evita repetir arquivos na mesma competência; uma competência nova continua sendo outra carga dos arquivos mensais, não um feed de alterações por empresa.
- `upsert` publica lotes sucessivos; não constitui uma troca atômica da competência e não remove, por si, todas as linhas que desapareceram do snapshot. `replace` faz TRUNCATE/carga e pode expor ausência ou carga incompleta se as consultas usarem diretamente essas tabelas.
- As receitas não são executadas automaticamente pelo pipeline. Devem ser escolhidas e atualizadas depois da carga. A receita de busca por nome restringe a matrizes ativas; não adotá-la como universo de todas as filiais.
- Não encontrei LICENSE/COPYING/NOTICE no commit; a API pública do GitHub retornou `license: null`. A descrição “open-source” não esclarece a licença de incorporação/distribuição. Resolver com o mantenedor antes de incorporar/publicar seu código no produto. Não foi enviada mensagem ao mantenedor e não foi copiado código para o Prometeus.

Fontes específicas: [configuração](https://github.com/caiopizzol/cnpj-data-pipeline/blob/f50632bae93b37abf26d01226433347c047d017f/config.py), [carga](https://github.com/caiopizzol/cnpj-data-pipeline/blob/f50632bae93b37abf26d01226433347c047d017f/database.py), [orquestração](https://github.com/caiopizzol/cnpj-data-pipeline/blob/f50632bae93b37abf26d01226433347c047d017f/main.py), [receitas](https://github.com/caiopizzol/cnpj-data-pipeline/tree/f50632bae93b37abf26d01226433347c047d017f/recipes).

## Verificação executada e limites

1. O próprio downloader consultou o repositório oficial: 42 competências disponíveis; mais recente `2026-10`, com 37 ZIPs. Foi consulta de metadados, não carga nacional.
2. PROPFIND de outubro retornou aproximadamente 7,27 GiB compactados; maior ZIP com 2,12 GiB. Isso não mede tamanho descompactado, PostgreSQL, índices, WAL, duas competências nem backup.
3. Foi baixado somente `Cnaes.zip`, 22.078 bytes. O processador original decodificou e leu 1.359 registros. Não foram baixados cadastros nacionais de empresas/sócios.
4. Seis arquivos de testes selecionados: 279 casos, 275 passaram e 4 falharam no Windows. Três exigiam privilégio de symlink; outro esperava `IsADirectoryError`, mas o Windows retornou `PermissionError` no mesmo cenário. Não foram alterados os testes para ocultar isso.
5. A coleta de toda a suíte PostgreSQL encontrou uso do módulo Unix `resource` no benchmark. A tentativa sem esse arquivo encontrou leitura de receitas SQL com encoding cp1252 no Windows. A causa foi reproduzida em um caso: `UnicodeDecodeError` em `Path.read_text()`. A execução ampla foi interrompida; não há alegação de suíte completa verde.
6. Uma seleção de integração PostgreSQL foi executada novamente com Python `-X utf8`: **10 passaram e 4 foram ignorados**. Cobriu retry de arquivos pendentes, replace entre competências/reprocessamento e execução de receitas de qualidade/detalhe. Os quatro casos de interrupção não rodaram neste Windows. Usa PostgreSQL 16 temporário e exclusivo, porta loopback 5435, sem volume/banco do Prometeus. O container próprio foi removido ao terminar.
7. O CI publicado pelo projeto para o commit examinado aparece como success: https://github.com/caiopizzol/cnpj-data-pipeline/actions/runs/39126501067 . Evidência do mantenedor, distinta dos testes locais.

Não confirmei o anúncio da imagem sobre “4 GB / 7 horas / R$ 50”. O processador usa lotes configuráveis e `low_memory=False`; não encontrei ajuste automático dos lotes à RAM disponível. Dimensionamento nacional e tempo de atualização continuam pendentes. Validar em Docker/Linux é o caminho operacional proposto.

## Dados que a base entrega

A Receita declara publicação mensal. A interface deve mostrar a competência publicada, data de importação e saúde da atualização, sem anunciar tempo real. O layout inclui razão social, nome fantasia, situação, abertura, CNAEs, porte, capital, endereço, telefone e e-mail cadastral quando preenchidos. Não inclui website, faturamento real ou quantidade de funcionários como campos desse layout. Capital social não é faturamento. Telefone cadastral não comprova WhatsApp; e-mail pode ser do contador e não do decisor.

Fontes oficiais: [nota RFB com periodicidade](https://www.gov.br/receitafederal/dados/nota_cocad_no_47_2024.pdf), [layout](https://www.gov.br/receitafederal/dados/cnpj-metadados.pdf), [repositório de arquivos](https://arquivos.receitafederal.gov.br/index.php/s/YggdBLfdninEJX9).

## Arquitetura proposta para CNPJ

1. Catálogo nacional compartilhado, isolado do banco transacional e dos dados privados de workspaces; PostgreSQL Docker com volume e credenciais próprios. Redis não é necessário para essa consulta nem para a fila já existente.
2. Importador reaproveitado, fixado em release/commit depois de esclarecer a licença. Agendamento verifica competência disponível e impede cargas concorrentes. Nunca executar `replace` no catálogo servido.
3. Carga da competência em destino novo; aplicar receitas selecionadas, verificar arquivos esperados, contagens, chaves, dicionários e consultas. Só depois publicar uma referência à competência aprovada. Preservar a anterior para rollback. Não confundir data de carga com atualização cadastral oficial.
4. Papel de leitura para o aplicativo; consultas parametrizadas, índices, timeout e paginação por chave. Filtros cadastrados e realmente suportados precisam aparecer na revisão. CNAEs principal/secundários devem ter semântica explícita; município não deve ser confundido com código IBGE automaticamente.
5. Adaptador `CNPJ` passa a consultar o catálogo; importar resultados para listas segue o fluxo atual de confirmação, escopo, evidência e deduplicação por CNPJ. Registrar competência/proveniência e limite de candidatos/consultas. Não reservar `apifyRuns` para uma consulta local.
6. Revisão e automação congelam a competência ou invalidam a revisão antes de executá-la se a política exigir a versão mais nova. Catálogo ausente/incompleto bloqueia a execução; não trocar silenciosamente para um serviço pago.
7. A carga nacional completa e seu dimensionamento são um aceite separado. Não prometer consulta nacional pronta apenas com o dicionário ou as fixtures.

## Situação real da coleta Web no nosso código

- Já existe HTTP real para páginas públicas. `fetchEvidencePack(..., true)` tenta somente a raiz, `/sobre` e `/contato`, com pacote total de 12 mil caracteres. Não descobre todos os links, não lê sitemap e não renderiza JavaScript. Isso ainda não atende à coleta abrangente pedida agora.
- O perfil Web atual usa `apify/google-search-scraper`, que produz SERPs, não a leitura integral dos sites encontrados.
- Divergência confirmada com o OpenAPI do build `0.0.468`: não existe `resultsPerPage`; `maxPagesPerQuery` descreve cerca de 10 resultados/página; idioma aceito inclui `pt-BR`, mas não `pt`. Nosso perfil usa `ceil(limit/100)`, envia `resultsPerPage` e `pt`.
- O leitor atual ainda busca apenas cinco registros SERP do dataset e achata `organicResults`. É necessário paginar SERPs corretamente, distinguir páginas cobradas de candidatos aceitos e cobrir datasets maiores/duplicatas em testes. Não basta atualizar a chave de API.
- Os testes de contrato atuais não substituem essa validação do contrato real fixado no build nem o piloto de resultados.

Também foi conferido o **Actor CNPJ já previsto**, `bigdavidson/brazil-cnpj-companies`, público e existente. Build observado `0.1.2`, ID `vtjaMYkiw3DKROihP`. O OpenAPI confirma `uf` e `city` como arrays e `maxRecords` para limitar empresas. O código atual envia `uf`/`city` como string e `limit` em vez de `maxRecords`; precisa de correção antes de conectar e gastar. Deve tratar separadamente linhas `tipo_registro=empresa/erro/aviso` e mapear os campos reais, sem classificar um run SUCCEEDED com avisos como uma busca integral bem-sucedida.

O autor informa Minha Receita como origem, BrasilAPI como fallback somente para lookup e **sem fallback de search**. E-mail é removido pela fonte, e contatos de EI/MEI podem ser ocultados. Assim, o Actor cadastral não entrega sozinho todos os contatos necessários à prospecção. É um componente comunitário com poucas avaliações; não equivale a uma API oficial com SLA. Fontes: https://apify.com/bigdavidson/brazil-cnpj-companies e seu input-schema.

Referências locais: `src/server/prospecting/providers/profiles.ts`, `apify.ts`, `extraction/fetch-page.ts`. Referência pública: [input do Google Search](https://apify.com/apify/google-search-scraper/input-schema).

## Alternativas para sites

| Opção | Benefício | Custo/limite |
| --- | --- | --- |
| HTTP local + navegador quando necessário + descoberta Apify | Menor custo variável possível, controle de cobertura/cache, reaproveita fila PG | Operação de browser, extração e bloqueios ficam conosco; economia precisa de benchmark |
| Descoberta e leitura gerenciada Apify | Menos operação de crawler; Website Content Crawler tem HTTP/browser e sitemap | Recursos/proxy/armazenamento cobrados; preço não é fixo por lead |
| Firecrawl Cloud | API pronta de crawl/search/Markdown | Créditos por página/funcionalidade; plano e limitações próprios |
| Firecrawl self-hosted | Controle da infraestrutura | Stack adicional; não é idêntico ao Cloud e não elimina custo operacional; licença AGPL-3.0 a avaliar na integração |

Recomendação de desenho: primeira opção, mantendo a segunda como alternativa explícita de coleta. Não instalar simultaneamente Crawlee, Firecrawl e outro agente de browser para fazer a mesma tarefa.

Crawlee pode coordenar HTTP e Playwright/Chromium, com filas de URLs e limites; licença Apache-2.0. Isso não exige que uma LLM controle cliques. Fonte: [links/crawling](https://crawlee.dev/js/docs/3.13/examples/crawl-relative-links), [licença](https://raw.githubusercontent.com/apify/crawlee/master/LICENSE.md).

O JEV retorna decisões estruturadas; não é navegador nem gerador de textos. Pode escolher entre candidatos fornecidos ou indicar necessidade de aprofundar. A convencional interpreta evidências e orienta exceções limitadas. Nosso Codex atual roda com ferramentas desabilitadas; a proposta é um coletor separado, não abrir acesso irrestrito ao processo da LLM. Fonte: [TypeSafe](https://docs.typesafe.ai/concepts/system-one).

## O que significa coletar direito

- Descobrir páginas por sitemap e links internos; normalizar URLs, retirar fragmentos/duplicatas e evitar armadilhas de calendários, busca, filtros e carrinho.
- Priorizar home, empresa, serviços/produtos, contato, unidades e casos. Um modo completo deve esgotar as URLs públicas descobertas dentro do domínio/escopo, sujeito ao orçamento aprovado. Não anunciar cobertura total se atingiu limite, bloqueio ou erro.
- Definir modos rápido/aprofundado/completo e limites revistos de páginas, profundidade, tempo, bytes, navegação e gasto. Como hipótese inicial: rápido até 10 páginas, aprofundado até 50; completo exige limite próprio aprovado. Isso ainda é proposta, não uma decisão fechada do produto.
- HTTP primeiro; renderizar apenas quando faltar conteúdo relevante por JavaScript. Interações automáticas limitadas a leitura/expansão; não enviar formulários, mensagens ou efetuar login para prospectar.
- Preservar controles de rede para páginas, redirects e subrecursos do browser; o controle de URL do HTTP atual não protege automaticamente um novo processo Chromium.
- Armazenar URL final, horário, hash, texto e cobertura (`descobertas/lidas/falhas/ignoradas/pendentes`, motivo de interrupção). Separar conteúdo literal de inferência.
- Cache de páginas públicas e deduplicação por domínio/versão evitam pagar novamente pelo mesmo site. Resultados personalizados por contexto/produto/workspace continuam privados.
- Não mandar o site inteiro para cada inferência: selecionar evidências relevantes, resumir uma vez e qualificar a partir delas. Memória de navegação não deve permitir que instruções da página autorizem ações.

## Actors e builds observados, sem execução paga

| Finalidade | Actor | Build público consultado | Estado |
| --- | --- | --- | --- |
| Empresas no Maps | `compass/crawler-google-places` | `0.14.775`, build ID `EH35UvIrsV0hnZG0Y` | Perfil já existe; preparar contrato fixado e piloto |
| Busca Google/SERP | `apify/google-search-scraper` | `0.0.468`, build ID `G3YvRcwtJopIgVcSA` | Perfil existe e precisa das correções acima |
| Conteúdo de sites, alternativa gerenciada | `apify/website-content-crawler` | tag padrão `version-0`, build `0.3.101`, ID `bsZdc9Cal4wAwV0VW` | Ainda não há adaptador no aplicativo |
| CNPJ/CNAE agora | `bigdavidson/brazil-cnpj-companies` | `0.1.2`, build ID `vtjaMYkiw3DKROihP` | Manter a estratégia Apify; corrigir contrato e validar resultados |
| CNPJ/CNAE futuro | Catálogo Receita/PostgreSQL | Competência publicada validada | Candidato condicionado às validações; não substituir agora |

Os builds mudam. Não usar `latest` silenciosamente; esses são candidatos examinados em 21/10, não um selo de aceitação de resultados. O OpenAPI de build foi obtido por `GET /v2/actor-builds/ID/openapi.json`; nenhum Actor foi executado. O crawler gerenciado permite limites efetivos; defaults examinados incluem `maxCrawlPages=9999999`, sitemap desligado e concorrência máxima 200: precisam ser sobrescritos.

Fontes: [Maps](https://apify.com/compass/crawler-google-places), [SERP](https://apify.com/apify/google-search-scraper), [Website Content Crawler](https://apify.com/apify/website-content-crawler), [input do crawler](https://apify.com/apify/website-content-crawler/input-schema).

## Custo de 5 mil leads/mês

Hipóteses: 5.000 empresas distintas, uma visita por empresa no mês, nenhum add-on de pessoas/reviews/imagens. Resultado bruto não é lead qualificado: uma taxa de aprovação de 20% exigiria 25 mil candidatos para obter 5 mil aprovados. Duplicatas, recrawls e falhas alteram os custos. Valores em USD, sem conversão cambial/impostos, observados em 21/10/2026.

Tarifas públicas de eventos obtidas na API dos próprios Actors, vigente `startedAt` até a consulta:

| Item | Free | Starter (Bronze) | 5 mil unidades no Starter |
| --- | --- | --- | --- |
| Maps: lugar básico | US$ 0,004/lugar | US$ 0,003/lugar | US$ 15 |
| Maps: contatos da empresa, adicional | US$ 0,002/lugar | US$ 0,002/lugar | +US$ 10 |
| Maps: cada filtro, adicional | US$ 0,001/lugar | US$ 0,001/lugar | +US$ 5 por filtro aplicado |
| SERP básica | US$ 0,0045/página | US$ 0,0025/página | US$ 12,50 por 5 mil páginas SERP |
| CNPJ: empresa retornada | US$ 0,003/empresa | US$ 0,003/empresa | US$ 15 + US$ 0,005/run |

SERP é cobrada por página de busca, não por empresa/site. Uma página pode conter vários resultados e muitos podem ser irrelevantes. Uma consulta por empresa representa 5 mil SERPs; uma descoberta por nicho é outro cenário. Não somar automaticamente Maps + SERP para cada lead.

Maps tem taxa de início observada de US$ 0,00005/run; extras de pessoas/verificação de e-mail/AI têm tarifas próprias. “A partir de US$ 1,50/mil” da vitrine não é a tarifa Starter básica; não usá-la no orçamento inicial. Fonte de metadados: https://api.apify.com/v2/acts/compass~crawler-google-places e https://api.apify.com/v2/acts/apify~google-search-scraper .

O Starter custa US$ 19/mês e inclui US$ 19 em uso, portanto não somar a mensalidade integral novamente sobre os mesmos primeiros US$ 19 consumidos. O Free anuncia US$ 5/mês em créditos, sujeito ao saldo da conta; a suposição anterior de ausência de franquia gratuita estava incorreta. Fonte: https://apify.com/pricing .

No CNPJ, 10 jobs de 500 resultados significam aproximadamente US$ 15,05 em eventos, sem acrescentar mensalidade integral sobre crédito já incluído. Não é orçamento de leads qualificados nem de enriquecimento completo. Para somente 5 mil resultados no total/mês, manter infraestrutura nacional pode custar mais que esses eventos; em muitos workspaces a mesma base local pode ser amortizada. Fonte do preço: https://api.apify.com/v2/acts/bigdavidson~brazil-cnpj-companies e https://apify.com/bigdavidson/brazil-cnpj-companies .

Para coleta, 5 páginas por empresa = 25 mil páginas; 20 páginas = 100 mil. O Website Content Crawler cobra recursos. O Starter anuncia US$ 0,20 por CU (1 GB RAM/hora). Simulações **somente de compute**, sem benchmark:

| Páginas por empresa | Páginas/mês | 1 GB-segundo/página | 5 GB-segundos/página | 20 GB-segundos/página |
| --- | --- | --- | --- | --- |
| 1 | 5.000 | US$ 0,28 | US$ 1,39 | US$ 5,56 |
| 5 | 25.000 | US$ 1,39 | US$ 6,94 | US$ 27,78 |
| 20 | 100.000 | US$ 5,56 | US$ 27,78 | US$ 111,11 |

Fórmula: páginas × GB-segundos/página ÷ 3.600 × US$ 0,20. O parâmetro agrega memória alocada e tempo amortizado por página; não equivale apenas ao tempo de rede individual. Somar tráfego, proxy quando usado, armazenamento/operações, retries e LLM. A Apify também recomenda piloto pequeno para estimar Actors por uso: https://docs.apify.com/actors/running/actors-in-store . Não apresentar essa tabela como preço completo ou limite monetário garantido de um Actor PPU.

Browser local tem compute/RAM, proxy, armazenamento e manutenção próprios. Pode reduzir a fatura variável se aproveitarmos capacidade existente, mas não posso afirmar que ganha do Apify sem medir os mesmos sites. LLM por clique aumenta tokens/latência e reduz previsibilidade; não é o padrão proposto.

Firecrawl Cloud anuncia 1 crédito por página básica e 2 por 10 resultados de search; formatos JSON/Question/Highlight acrescentam 4 créditos/página. Hobby mensal: US$ 19/5 mil créditos; Standard: US$ 83/mês equivalentes com cobrança **anual**, 100 mil créditos. 5 mil leads com 5 páginas já precisam de 25 mil créditos, não do plano de 5 mil. Busca e formatos extras compartilham o saldo. Fonte: https://www.firecrawl.dev/pricing . Self-hosting tem recursos/limites diferentes e operação própria: https://docs.firecrawl.dev/contributing/open-source-or-cloud .

JEV 1.13 anuncia US$ 0,042 por milhão de tokens de entrada. Cenário de 5 mil tokens por empresa × 5 mil empresas = 25 milhões, aproximadamente US$ 1,05 para uma classificação por empresa, **sem coleta nem geração convencional**. A convencional depende do modelo/tokens. Codex OAuth é o caminho local de testes, não custo unitário conhecido/ilimitado para o SaaS público. Fonte: https://openrouter.ai/typesafe/jev-1.13 .

Catálogo CNPJ compartilhado custa carga/armazenamento/backup independentemente de cada consulta. Não vale prometer “zero custo” nem multiplicar a base nacional por workspace. Não foi cotado um servidor específico ou medida a capacidade de 4 GB.

## Preparação sem créditos

Ver o checklist irmão `2026-10-21-provider-setup-checklist.md`. Pode-se preparar segredos, contratos, budgets, revisões e fixtures sem executar Actors/inferências. Autenticado/configurado não significa busca validada. O aceite precisa registrar explicitamente o que foi verificado sem consumo e o que aguarda saldo/piloto.

## Próximo desenho a aprovar

Manter CNPJ Apify por enquanto; corrigir seus contratos de UF/cidade/limite/output e os de SERP, separar descoberta de crawl e definir um coletor HTTP/browser independente das LLMs. Manter confirmações e limites atuais. A eventual substituição por catálogo local fica condicionada à licença e à validação nacional. O marco de canais/envio deve continuar depois desse ajuste; não é necessário conectar três coletores para iniciar.

O Setup foi consultado e retornou OAuth obrigatório; posteriormente o usuário pediu explicitamente ignorá-lo. Nenhuma ferramenta foi instalada no aplicativo por causa desse bloqueio. REA foi consultado por skill; sua orientação é usar ferramentas normais para um repositório completo, então não houve engenharia reversa/decompilação nem recriação do pipeline.
