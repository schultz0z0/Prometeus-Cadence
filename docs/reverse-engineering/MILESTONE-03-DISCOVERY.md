# Marco 03 — retomada da investigação

Data: 20/10/2026. Base publicada dos marcos 01–02: `178cbf9`. Preparação em `codex/prospecting`; nenhum código de produto alterado nesta investigação.

## Intenção e decisões do usuário

Avançar para prospecção, extração e qualificação reais preservando os fluxos observados do CadenceFlow: fontes separadas, formulários, preview e confirmação, progresso de execução e ausência de chat como fluxo principal. O usuário possui contas Apify e Apollo, sem saldo/créditos adicionados, e escolheu construir pensando no Apify. A existência de plano gratuito não autoriza supor saldo ou elegibilidade dessas contas.

O provedor de IA para resumo e veredito ainda não foi informado. A pergunta foi enviada ao usuário; isso não será preenchido por uma escolha silenciosa.

## Evidência reaproveitada

`FINDINGS.md`, `SURFACE-MAP.md`, os prints U01–U18 e a projeção REA `evidence/rea-client-summary.json` permanecem as referências. A investigação anterior confirmou campos e fluxos acessíveis, sem executar buscas pagas, conectar canais ou verificar o backend privado.

Escopo observado relevante: Maps, web, CNPJ e Apollo; filtros cadastrais; limite visível de até 500 itens; extração de contatos, descoberta de site, resumo e veredito; deduplicação por e-mail/CNPJ/telefone na lista ou no workspace. A declaração de uma base local de 120M+ registros no concorrente não comprova sua composição e não será apresentada como capacidade do Prometeus.

## Disponibilidade nesta retomada

- Skill REA disponível; MCP REA respondeu a `list_browser_targets` em `http://127.0.0.1:9222`, com filtro exclusivo `https://app.cadenceflow.pro`. Resultado: nenhum target permitido. Identidade da evidência: `ev_37d800c5b76706656cc03d95f2158cb239fc6a456f718593a01db53f2b063def`.
- Tentativa de consultar a aba `/inbox` pelo conector Chrome retornou `Local browser use is disabled in Work settings`. Não foram alteradas configurações nem aberta uma cópia não autenticada como substituto da sessão do usuário.
- `setup-agent` não está anunciado entre as ferramentas desta sessão; a consulta de disponibilidade ao endpoint anteriormente configurado `https://setup.omatheusdaia.com.br/api/mcp` retornou HTTP 401. Não houve busca autenticada no acervo nem conclusão de que ele não contém recurso adequado. Nenhum MCP, plugin ou skill novo foi criado ou instalado.

## Contratos públicos conferidos

1. [Apify Free](https://apify.com/pricing) anuncia US$5/mês de uso. Não foi verificado o saldo da conta do usuário.
2. [Apify Run Actor](https://docs.apify.com/api/v2/actors-runs-post) inicia uma execução assíncrona. Run ID e dataset devem ser persistidos e consultados; o worker não depende de manter uma requisição Next aberta.
3. [Limites de execução](https://docs.apify.com/api/client/js/reference/interface/ActorStartOptions): `maxTotalChargeUsd` aplica-se a Actors pay-per-event; `maxItems` limita cobrança pay-per-result, sem garantir a quantidade retornada. Esses campos não serão anunciados como teto universal de todos os custos da plataforma.
4. [Apollo People API Search](https://docs.apollo.io/reference/people-api-search) informa zero créditos, exige conta gratuita com e-mail profissional e pode ter outros critérios de elegibilidade. Não retorna e-mail ou telefone; enriquecimento é outra operação.
5. [Apollo Organization Search](https://docs.apollo.io/reference/organization-search) informa um crédito por página, de até 100 resultados. Não tratar a busca empresarial como gratuita por ser uma conta Free.

Actors com contratos publicados inspecionados, sem iniciar runs: [Maps mantido pela Apify](https://apify.com/compass/crawler-google-places/input-schema), [busca Google mantida pela Apify](https://apify.com/apify/google-search-scraper/input-schema) e [candidato CNPJ de terceiro](https://apify.com/bigdavidson/brazil-cnpj-companies/input-schema). A existência do contrato publicado não comprova qualidade, disponibilidade na conta, compatibilidade de todos os filtros ou sucesso em produção. O candidato CNPJ não substitui uma base nacional local já importada.

## Abordagens para o desenho

- **Adaptadores independentes + worker e fila no PostgreSQL existente:** aproveita isolamento, transações e ambiente Docker do marco 02. Dá controle de retomada, cancelamento, deduplicação e ledger por workspace. É a direção proposta; não requer Redis neste marco.
- **Execução dentro da requisição web:** implementação inicial menor, mas uma desconexão ou timeout não pode determinar o estado de um processamento externo já iniciado. Não atende bem o aceite de retomada.
- **Base CNPJ nacional e coletores totalmente próprios agora:** controle maior da origem, com nova operação de ingestão, atualização e armazenamento. Amplia o marco além da primeira integração com os provedores que o usuário já escolheu.

## Requisitos a carregar para o desenho e o plano

- Ação explícita antes de iniciar execução externa; fonte, filtros, destino e limite ficam registrados.
- Credenciais no servidor, sem chaves no bundle, DTO, URL pública ou logs. Configuração ausente/sem crédito mostra requisito real; não gera dados fictícios como sucesso.
- Jobs persistentes com fila, lease/heartbeat, paginação e checkpoints; status de cancelamento solicitado separado do cancelamento confirmado no provedor.
- Retry de start externo com resposta perdida não pode disparar outro run cobrável sem reconciliação. Não assumir idempotência do provedor sem contrato comprovado.
- Uso por workspace e controle agregado da credencial compartilhada. Reserva, consumo e liberação idempotentes; custo externo desconhecido permanece desconhecido.
- Normalização e deduplicação transacionais, inclusive em duas buscas concorrentes. Não fundir empresas diferentes somente porque compartilham o telefone de uma central ou e-mail contábil.
- Origem e timestamps dos dados, resultados por módulo, razão e evidência do veredito. Falha de extração não equivale a desqualificação.
- Preservar correções humanas durante a qualificação; job não pode sobrescrever campo alterado depois de sua preparação.
- Testes de contrato offline, integração real com PostgreSQL e validação da UI fazem parte do aceite local. Smoke externo é separado e exige credenciais, saldo/elegibilidade e limite definido. Uma integração não exercitada no provedor será declarada como tal.
- Cadências continuam rascunhos, automações pausadas e nenhum envio é ativado. Scheduler recorrente e cobrança comercial permanecem nos marcos seguintes.

Este documento registra descoberta e propostas; não é aprovação do desenho detalhado nem evidência de integração concluída.
