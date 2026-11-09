# 06B.6d — Substituição do leitor de sites da Apify

O serviço local compila o Scrapling 0.4.6 do submódulo oficial em `third_party/scrapling`, revisão `ced9a8d63c7da93839ff40968c08262b78ff254f`, com Playwright 1.58.0 e Chromium. O Gerador, nas operações que leem sites, a Prospecção completa, o Qualificador, o Enriquecedor, as investigações de empresas e decisores e a leitura de contexto usam esse coletor. A busca de URLs, o Maps e a Base CNPJ continuam nas respectivas fontes.

O adaptador recusa novos disparos do Website Content Crawler. Os identificadores e perfis históricos permitem conferir ou encerrar runs conhecidos com os controles existentes. Uma revisão criada com a configuração anterior pode exigir nova confirmação. As evidências já publicadas ficam no histórico. Um serviço ocupado ou temporariamente indisponível adia a etapa por 30 segundos na mesma execução. A fila persistente da Prospecção completa mantém as páginas concluídas. Os demais leitores preservam as leituras concluídas no diário e podem repetir um pacote de páginas ainda sem recibo. Bloqueio de acesso e timeout da página têm tratamento separado da indisponibilidade do serviço.

O Gerador informa o estado do navegador em **Status das integrações e histórico**. A ativação operacional exige o mesmo `SITE_BROWSER_TOKEN` protegido no serviço e no runtime, o gateway em `127.0.0.1:3222` e `SITE_BROWSER_ENABLED=true`. A pausa usa `SITE_BROWSER_ENABLED=false`. O coletor respeita robots.txt e os limites do recorte, com bloqueio de destinos privados e de acessos diretos ao LinkedIn e à Unipile.

## Verificação

- Os 12 testes de Chromium em Docker, com a rede externa desabilitada, exercitaram conteúdo JavaScript, links de contato, redirecionamentos, timeout, bloqueios e autenticação do gateway. Os 462 testes unitários, o build e a checagem de tipos passaram.
- A integração isolada exercitou a leitura via Chromium no caminho antigo do Maps, a espera e a retomada do Qualificador, a preservação do recibo após revogação e a alimentação do Enriquecedor com trecho indexado sem visita direta ao LinkedIn.
- A suíte completa de integração teve 685 aprovações, cinco casos reais de Stripe desabilitados e uma falha no limite de desempenho de Relatórios. O p95 foi de 268 ms na suíte com outros processos de validação em execução. O mesmo teste, executado sozinho depois da suíte, passou com p95 de 99 ms para o teto de 250 ms. O código de Relatórios ficou fora do corte.
- No Chrome local, a jornada `pack` mostrou **Navegador · disponível** no Gerador, abriu e fechou a revisão em 1920×855 e 390×844 e confirmou zero execuções de prospecção e zero operações de cobrança para a conta descartável. O script removeu a conta e verificou resíduo zero. Capturas da revisão em `output/playwright/registry-first/`.
- O auditor registrou 8/138 no hash `c5867dcc3c9dcfb269bfeeeb16d262813d9fbc0f3351a3d647eb86c6eb8acb18`. A jornada seletiva desta rodada não atualiza os relatórios globais do 08A. A base de conhecimento manteve os quatro erros históricos de `clone/barriers.md`.
- Durante o primeiro teste de regressão, o caminho antigo pôde tentar alcançar a Apify com uma credencial fictícia. A resposta dessa tentativa ficou sem verificação. O teste final intercepta o transporte e proíbe tráfego externo.

O ambiente compartilhado ainda exige ativação controlada. A medição do lote de 250, dos recortes complementares de CNPJ e do piloto real segue no 06B.6c/06B.6e.
