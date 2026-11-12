# Prometeus Cadence — Passagem para o Claude Code

## Relatório de passagem

O desenvolvimento foi pausado no início do **06B.7 — Prospecção em etapas**, após reproduzir a primeira falha esperada. O roadmap revisado foi aprovado. A implementação desse marco ainda está pendente.

| Item | Estado no momento da passagem |
| --- | --- |
| Repositório local | `D:\Projetos SaaS\Projetos Pessoais\Prometeus Cadence`, Windows |
| Git | Branch `claude/calendar-07c2c`, sem upstream. `HEAD` local `963d8ba` |
| Últimas decisões versionadas | `963d8ba` replanejou o release. `0f235bd` registrou o piloto real e a prova de admissão com Chromium. `7425a7d` registrou a verificação das duas faixas de abertura cadastral. |
| Trabalho do 06B.7 em andamento | Um teste RED local, ainda sem commit, em `tests/integration/06b5-prospecting-journey.test.ts`, linha 547. Código de aplicação ainda no baseline. |
| Resultado do RED | `node scripts/test-integration.mjs 06b5-prospecting-journey` executou 32 testes. Passaram 31. O novo teste recebeu HTTP 200 onde esperava 409. O teste cobre abertura de jornada, tentativa de retomada, histórico, pausa e contagem de jobs. Log em `output/06b7-red.log`. |
| Alterações preexistentes | Há uma edição no plano de franquias e arquivos não rastreados em `.claude/`, docs e `tests/experiments/`. Preserve-os e delimite os commits do marco por arquivo. |
| Runtime local | O supervisor contínuo estava ativo, com a lane `jobs` em espera. A porta 3210 estava livre. Banco operacional `prometeus_cadence` no container `prometeus-cadence-db-1`. |
| Base técnica | Next.js 16.4.2, React 19, TypeScript strip-only, Zod 4, Postgres com RLS forçada e papéis separados. Última migração rastreada `113f-site-page-queue.sql`. Scrapling oficial em `third_party/scrapling`, revisão `ced9a8d63c7da93839ff40968c08262b78ff254f`. |

**Para outra máquina ou sessão remota.** O commit `963d8ba` e o teste RED precisam estar no checkout que o agente receber. A branch tem commits locais e nenhum upstream. Use o mesmo checkout local ou um meio de transferência Git expressamente autorizado. O teste RED pode ser recuperado no checkout local com `git diff -- tests/integration/06b5-prospecting-journey.test.ts` ou recriado pelo contrato descrito abaixo. As credenciais ficam no ambiente protegido de cada instalação. O `.env.local` fica fora da transferência de código.

**Resultado que motivou a mudança.** A busca integrada em Curitiba avaliou 10 candidatos e inseriu zero. Nove ficaram sem confirmação no Maps e a décima ficou sem site verificável. Um caso separado, com CNPJ e Maps reais já coletados, provou que o Chromium lê o site e que o worker pode inserir o lead com evidência das três fontes. A capacidade de 250 inserções foi provada com fontes simuladas. Essas três evidências medem coisas diferentes. [Piloto](06b6e-prospecting-live-pilot.md) · [Capacidade](06b6e-site-browser-capacity.md)

**Referência observada.** O RES registrou as telas do CadenceFlow em modo leitura e o REA analisou arquivos do acervo local. O Gerador escolhe uma fonte e salva uma lista. O Qualificador trabalha sobre uma lista existente. O Enriquecedor da referência exige empresa qualificada, com CNPJ e ainda sem enriquecimento. A busca de CNPJ ausente como investigação separada é uma capacidade própria do Prometeus. [EV-321](../reverse-engineering/visual-2026-10-25/evidence/EV-321-lead-flow-reference.md)

**Aceite atual.** O 08A.8 registrou 117/138 no seu hash. O auditor atual reconhece 8/138 porque os relatórios globais anteriores ficaram fora do hash atual. Regerar as medições ao fim das alterações e manter os bloqueios externos separados. O verificador da base tinha quatro erros preexistentes em `clone/barriers.md`. [Relatório do 08A.8](08a8-live-visual.md) · [Conexões externas](08a8-conexoes-externas.md)

## Prompt pronto para colar

```text
Continue o desenvolvimento do Prometeus Cadence. Responda em português do Brasil. O operador aprovou o roadmap revisado e o desenvolvimento do 06B.7. Comece por esse marco e siga a ordem vigente do roadmap. A meta é fechar a implementação e os aceites de cada recorte, homologar com contas próprias e preparar a implantação do 08B. Peça autorização para ações externas, pagas ou públicas quando o escopo concreto chegar.

ESTADO DE PARTIDA

- No Windows, o checkout original é D:\Projetos SaaS\Projetos Pessoais\Prometeus Cadence. Branch claude/calendar-07c2c sem upstream. HEAD esperado no handoff 963d8ba. Confirme com git log -5, git status e git branch. Os commits ainda são locais. Se o ambiente for remoto, confirme que recebeu o histórico antes de trabalhar. Preserve .claude/, o plano de franquias já modificado e os experimentos preexistentes.
- O desenvolvimento parou antes do GREEN. Em tests/integration/06b5-prospecting-journey.test.ts existe um RED local não commitado, “06B.7 keeps legacy history and pause without accepting new integrated work”. A suíte teve 31 passes e uma falha esperada, HTTP 200 em vez de 409. Se o diff não chegou, recrie esse teste e veja-o falhar antes de implementar. O log original fica em output/06b7-red.log quando disponível.
- Next.js 16.4.2, React 19, TypeScript strip-only, Zod 4 e Postgres com RLS forçada. O banco operacional local é prometeus_cadence no container prometeus-cadence-db-1. O worker contínuo compartilha esse banco. Última migração rastreada no handoff 113f-site-page-queue.sql.

LEIA PRIMEIRO

1. AGENTS.md e, no Windows, o RTK.md que ele referencia. Leia os guias aplicáveis em node_modules/next/dist/docs antes de alterar código Next.js.
2. docs/superpowers/plans/2026-10-20-prometeus-cadence-roadmap.md, seção Caminho restante para a homologação.
3. docs/superpowers/plans/2026-10-27-prometeus-cadence-master-plan.md e 2026-10-27-prometeus-cadence-implementation-manifest.json. O next é 06B.7 e o fim do roadmap é 08B.
4. docs/superpowers/plans/2026-11-09-prometeus-cadence-06b7-prospeccao-em-etapas.md. Use-o como plano executável do marco.
5. docs/reverse-engineering/visual-2026-10-25/STATUS.md e evidence/EV-321-lead-flow-reference.md. Consulte o acervo do RES, a análise REA e as capturas em output/playwright/visual-audit/ quando disponíveis. O CadenceFlow é somente leitura. Use REA e RES para esclarecer divergências, sem tratar o JavaScript como prova de comportamento do backend.
6. docs/validation/06b6e-prospecting-live-pilot.md, 08-release-matrix.json, 08a8-live-visual.md e 08a8-conexoes-externas.md. Separe prova local, prova real, lacuna de evidência e decisão de produto.

IMPLEMENTE O 06B.7

1. Gerador por fonte. Ofereça Google Maps, Busca na web, Base CNPJ e Apollo com conexão própria. Salve em lista nova ou existente, preserve filtros e deduplicação e aceite dados parciais válidos segundo a fonte. CNPJ, site e Maps deixam de ser pré-requisitos conjuntos de captação. Preserve franquias, créditos adicionais, renovação mensal sem acúmulo e limites diários aprovados.
2. Retire a criação da jornada “Prospecção completa” do Gerador e do assistente de público das Automações. Os pontos conhecidos são src/modules/prospecting/server-generator.tsx e src/modules/automations/server-audience-wizard.tsx. Confira assistente, ajuda e histórico para evitar CTAs quebrados. Proteja a API em src/server/research/journey-http.ts contra criação e reabertura que iniciem trabalho integrado novo. Teste 409 com LEGACY_JOURNEY_ARCHIVED e zero jobs novos, mantendo acesso autorizado ao histórico, pausa e reconciliação. Preserve resultados, recibos, propostas já existentes e rascunhos. Alguns testes históricos criam jornada pela antiga API. Preserve a cobertura do serviço de legado em fixtures isoladas e atualize as asserções do contrato HTTP vigente.
3. Qualificador sobre lista existente. Exercite módulos escolhidos, lead sem site ou CNPJ, descoberta de domínio institucional, evidência ambígua e recuperação após falha. A IA propõe aderência e resumo conforme as opções. A aplicação humana é explícita. O usuário vê o motivo de cada abstenção ou módulo pulado. Reaproveite src/server/prospecting/qualification.ts e as suítes existentes.
4. Enriquecedor padrão. Confira elegibilidade no servidor e na revisão. Empresa qualificada, CNPJ confirmado e elegibilidade para nova resolução governam o lote de decisores. Preserve a investigação separada de empresa sem CNPJ, feita pelo fluxo companyPeople, com resultado revisável e atribuição sustentada. Confira src/server/prospecting/enrichment-context.ts, src/server/research/people.ts e src/modules/prospecting/enrichment.tsx. Exercite homônimos, contato sem prova, cache, repetição, teto e reservas. Nunca atribua telefone corporativo ao decisor.
5. Preserve o Scrapling oficial com Playwright e Chromium para ler páginas. A Apify continua em CNPJ, Maps e descoberta de URLs. O Website Content Crawler da Apify fica fora de novas leituras de site. Preserve retomada por URL, política de robots, bloqueio de destinos privados e isolamento.

VALIDAÇÃO E CONTINUIDADE

- Faça RED, GREEN e revisão independente somente leitura. Compare as três telas com a referência no mesmo viewport e estado. Use 1920×855, 390×844 e prova em 320 px. Cubra teclado, papéis, loading, erro de rede, vazio, parcial, sucesso e histórico. Use contas [RE] com e-mails example.com, removidas por ID com tests/manual/qa-cleanup.mjs e resíduo zero.
- No Windows, Playwright já estava no cache do npx. Aponte QA_PLAYWRIGHT_MODULE para o módulo em file:///C:/Users/rapha/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright/index.mjs e QA_CHROME_PATH para C:/Program Files/Google/Chrome/Application/chrome.exe, se esses caminhos existirem. Em Git Bash, use MSYS_NO_PATHCONV=1. A jornada full-journeys.mjs --only=pack permite verificação focada e não grava o relatório global. Respeite o 429 de cadastro e aguarde cerca de 75 s entre rodadas. npm run dev usa 127.0.0.1:3210 e seu predev inicia o runtime, então confira o estado antes de executar.
- Rode primeiro as suítes focadas. Depois rode npm test, npm run test:integration, npm run build, npm run typecheck, git diff --check e node scripts/audit-release-coverage.mjs. As integrações usam banco efêmero. Separe a suíte de desempenho de Relatórios da carga de navegador quando necessário. Refaça a medição final depois de editar src, db/migrations, scripts/lib ou tests/manual. Registre os resultados no relatório, na revisão, no manifesto, na matriz e no acervo. Atualize status só pelo aceite medido. Faça commits locais focados conforme as regras do projeto.
- 06B.6e e 06IA-H homologam separadamente Gerador, Qualificador e Enriquecedor. Use a aplicação em conta própria autorizada, registre fonte, custo, duração, descartes, evidência e reservas. Observe a leitura Chromium no worker contínuo em módulo avulso. Apollo é opcional e depende de acesso à API de pesquisa. A jornada integrada histórica 06B.6c não é gate do release. O teste sintético de 250 não comprova rendimento real de fornecedores.
- Feche 06A-V e 08A com as medições atuais. Em paralelo, prepare o 08B local com prontidão, restore isolado, carga, soak, observabilidade e rollback. Quando autorizado, use HTTPS de homologação restrita para MCP, OAuth e webhooks antes do aceite integral do 08A. Ative produção pública somente depois dos gates aplicáveis de 08A, 06B.6e e 06IA-H e da autorização específica.
- Mantenha as dependências externas visíveis. Canais próprios, LinkedIn/Unipile, piloto SDR, Google, MCP, webhooks, SMTP público e Stripe live exigem insumos e autorização conforme o inventário. CRM precisa de escolha de fornecedor e implementação. 07D é condicional e depende da decisão de incluir ou excluir. Os preços anuais de adicionais e a regra de recursos acima do limite após reassinatura também têm decisões próprias.

LIMITES OBRIGATÓRIOS

- Credenciais só em configuração protegida. Não leia para exibir, copie para arquivos rastreados ou transmita .env.local. Preserve RLS, papéis e autoridade no servidor. Migrações aplicadas têm checksum. Crie migração nova se necessária. O runner exige $$ para PL/pgSQL e parênteses em CASE usado como condição de IF.
- Nunca semeie jobs queued/running no banco compartilhado. Teste execução com fontes simuladas em catálogo efêmero. No banco operacional, use o fluxo oficial somente em homologação real autorizada. Em QA, não ative cadência ou canal, não clique “Aprovar e enviar” e não dispare mensagens.
- CadenceFlow somente leitura. Sem POST/webhook de terceiros, aprovação OAuth, contratação, aceite de termos, chamadas reais à Unipile ou LinkedIn, nova escrita no Stripe, push, merge, deploy ou DNS sem autorização expressa para a ação. Autorizações de pilotos antigos não cobrem rodadas novas. A vontade de implantar pelo Claude Code define o executor, não autoriza o momento nem o destino da implantação.
- Preserve trial de sete dias, créditos adicionais pré-pagos, OpenWA gerenciado e Apify/IA centrais. Mantenha serviços sem prova fora da oferta contratável. Nunca declare paridade integral sem evidência.

Comece confirmando o checkout e o RED. Entregue o 06B.7 local e atualize o próximo passo do manifesto conforme a verificação. Siga pelas tarefas locais autorizadas e concentre pedidos de entrada ou autorização nos gates que realmente dependem do operador.
```
