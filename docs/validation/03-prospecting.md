# Marco 03 — prospecção e qualificação

20/10/2026. Reconstrução independente baseada no desenho aprovado e evidências anteriores do REA. A arquitetura privada do CadenceFlow continua desconhecida.

## Entregue e verificado

Jobs persistentes, revisão HMAC com validade, confirmação idempotente, reservas por workspace e globais, histórico paginado, evidências, deduplicação por origem/CNPJ, worker separado com papel mínimo/RLS, leases/fences, journal de chamadas, resultado parcial, cancelamento e reconciliação administrativa. Qualificação guarda propostas; aplicar exige confirmação e compara campos-base e contexto.

Apify Maps/Web/CNPJ exige Actor/build explícito. Apollo usa Organizations. Extração fixa IP aprovado após DNS, bloqueia redes privadas e revalida redirects; máximo três páginas, 1 MiB por corpo e 12 mil caracteres por pacote. JEV `typesafe/jev-1.13` usa Decisions API. Codex local usa o executável autenticado por ChatGPT sem copiar OAuth ou receber chaves de outros serviços.

Testes PostgreSQL exercitam concorrência, repetição, perda de resposta, lease expirada, revogação durante execução, partial, cancelamento durante start, edição humana/contexto e aplicação idempotente. No navegador: desktop1440px/mobile390px, revisão sem credenciais com confirmação desabilitada, resultado parcial, cancelamento e aplicação anterior/proposta. Um e-mail sintético editado após preparação produziu `RESULT_CONFLICT`, preservou a edição e manteve o modal aberto. Restaurada a base QA, o mesmo pedido foi aplicado uma vez. Console final sem erros.

Fixtures ficam no workspace **QA · Marco 03 · fixtures**, separado dos dados anteriores. O harness privado `tests/manual/seed-prospecting-ui.mjs --local-qa` exige banco loopback e a conta verificada de QA; não há rota/fallback de mock. A etiqueta identifica material sintético. Capturas foram inspecionadas inline; o MCP Chrome recusou gravação por sua política de workspace roots, sem contornar a restrição.

Build usa webpack suportado pelo Next instalado após Turbopack parar sem progresso nesta máquina. Não houve chamada de inferência ou busca real a Apify/Apollo/JEV/Codex: chaves/saldo/limites não foram disponibilizados ao aplicativo. Nenhum crédito comprado ou assinatura ativada. CLI versão/help/features/login foram apenas inspecionados. **Avaliação empírica pendente**: fixtures provam contratos, não precisão, custo ou latência reais. Confiança JEV não é acurácia medida.

## Operar localmente

```powershell
rtk npm run env:init
rtk npm run db:up
rtk npm run db:migrate
rtk npm run db:migrate -- --test
rtk npm run build
rtk npm start
# Em outro terminal:
rtk npm run worker
```

`env:init` preserva valores existentes e acrescenta somente os ausentes do worker. Configure `.env.local` no editor local conforme `.env.example`; nunca envie chaves ao chat, Git ou frontend. Defina `PROSPECTING_ENABLED=true` e limites JSON `PROSPECTING_WORKSPACE_DAILY_UNITS`/`PROSPECTING_GLOBAL_DAILY_UNITS`, com dimensões independentes. Ausentes/inválidos valem zero. Sem credenciais e budget a revisão bloqueia confirmação.

Apify: token, Actor permitido, build fixado, limites de itens/tempo. `APIFY_*_PPE=true` somente após conferir PPE no build; só então se envia `maxTotalChargeUsd`. Não há teto monetário universal em perfis sem esse suporte. Apollo empresas pode consumir créditos e exige elegibilidade própria. CNPJ exige CNAE ou CNPJ e filtros suportados, sem base nacional copiada localmente. E-mail verifica formato/DNS, não existência da caixa.

Codex: `CADENCE_RUNTIME_MODE=local`, origem loopback, `CODEX_LOCAL_ENABLED=true`, caminho absoluto `CODEX_BINARY`, `CODEX_MODEL` e `CODEX_TEST_WORKSPACE_IDS`. Versão verificada `codex-cli 0.163.0-alpha.10.2`; upgrades exigem rever flags. Execução serializada pelo PG, cwd temporário, stdin, JSON schema, ferramentas desabilitadas, limites de saída/tempo; sem fallback. CLI para QA local, não endpoint comercial multiusuário.

`rtk npm run worker -- --once` processa um passo. Reiniciar não apaga checkpoints/recibos. Resposta incerta requer revisão administrativa em `/executions/[id]` antes de outro POST. Cancelar solicita abort e não promete estorno. Gerador/qualificador/histórico/status: `/leads/generator`, `/leads/qualifier`, `/executions`, `/settings/apps`.

## Avaliação e smokes

Gold JSON: `[{"id":"caso-1","companyId":"empresa-1","domain":"empresa.example","split":"adjust","label":"fits"}]`.

Predições: `[{"id":"caso-1","verdict":"fits","costUsd":null,"latencyMs":100,"escalated":false,"model":"typesafe/jev-1.13","contractVersion":"jev-decisions-v1","evidenceHashes":["..."]}]`.

Rotule 100 empresas com evidência arquivada, 50 para ajuste e 50 para teste, agrupadas por empresa/domínio. Dois revisores humanos resolvem divergências; não use LLM como gabarito. Registre critérios/data/revisão em material privado. Não foi fabricado dataset de100 resultados.

`rtk proxy node --experimental-strip-types scripts/evaluate-prospecting.mjs gold.json predictions.json test` calcula matriz, precisão/recall, abstenção, cobertura, escala, custo conhecido/incompleto e p50/p95. Predição faltante é erro; use abstenção explícita. Mesmo domínio/empresa nos dois splits é rejeitado.

`rtk proxy node scripts/smoke-prospecting.mjs` retorna **SKIPPED** por padrão. Real exige `--live --source JEV|CODEX|MAPS|WEB|CNPJ|APOLLO --workspace ID --limit 1 --budget-units 1`, allowlist servidor `PROSPECTING_SMOKE_WORKSPACE_IDS`, configuração e reservas. Provedores cobrados exigem `--confirm-provider-cost`. Fontes exigem `--term`, localização/CNAE aplicáveis e criam job: **QUEUED não é sucesso do provedor**. JEV/Codex usam uma evidência sintética e no máximo uma inferência; propostas não são aplicadas. Use workspace QA vazio/exclusivo; o smoke cria registros.

## Fora deste marco

Scheduler recorrente, IA de audiências/cadências, envio de e-mail/WhatsApp/LinkedIn, inbox real, assinatura/billing e operação pública. Automações pausadas, cadências rascunhos. Não se declara paridade integral.

Verificação antes da revisão independente: unit64/64, integração36/36, typecheck0, build webpack0, smoke48/48. Banco exclusivo reiniciado saudável; worker --once0 e dados QA preservados. Smoke de provedores sem flags: SKIPPED. Integração exclusivamente `_test`; smoke anônimo testa redirects/401. Matriz em `03-provider-matrix.json`.
