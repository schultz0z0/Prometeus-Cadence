# Marco 03 — Prospecção e qualificação híbrida Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, preserving the user's native execution choice. Steps use checkbox (`- [x]`) syntax for tracking. One independent whole-branch review follows implementation; no implementer delegation.

**Goal:** Executar buscas e qualificações persistentes com Apify/Apollo, JEV 1.13 e geração local pelo Codex CLI, mantendo confirmação, isolamento, retomada e uso auditável.

**Architecture:** APIs autenticadas preparam/confirmam jobs; um worker Node independente os processa pelo PostgreSQL existente, com lease, checkpoints e ledger. Adaptadores de fontes, coleta, decisão e geração têm contratos separados. Fixtures exercitam os contratos sem custos externos; smokes reais são separados e identificados.

**Tech Stack:** Node 24, Next 16.4.2, React 19.3.1, PostgreSQL 18, pg 8.23.1, Zod 4.6.7, fetch/crypto/http/https/dns/child_process nativos. Dependências novas, somente na T4: `parse5@8.0.1` e `ipaddr.js@2.5.0`, versões conferidas no registry em 20/10/2026. Sem Redis nem SDK de IA novo.

**Spec:** `docs/superpowers/specs/2026-10-20-prometeus-cadence-03-prospecting-design.md`, aprovada pelo usuário em 20/10/2026. Apoio: `docs/reverse-engineering/JEV-HYBRID-STUDY.md` e `MILESTONE-03-DISCOVERY.md`.

## Global Constraints

- Preservar `typesafe/jev-1.13`, sem trocar pelo modelo mais novo ou por um router.
- Automações existentes continuam pausadas e cadências rascunhos. Nenhum envio é ativado.
- Até 500 candidatos/registros por job; lotes/páginas de até 100; uma operação externa ativa por workspace; Codex com concorrência 1 na máquina.
- Leitura profunda: até três páginas por domínio, corpo de até 1 MB por página. Evidência de decisão limitada a 12.000 caracteres por lead, com truncamento/seleção declarado.
- Codex somente no modo de implantação local explícito, com binding loopback e workspace de testes autorizado no servidor; não depender apenas de `NODE_ENV` ou Host do cliente.
- Não copiar tokens OAuth para tabela, `.env`, frontend ou transporte HTTP próprio. Credenciais externas permanecem no servidor e não são `NEXT_PUBLIC_*`.
- Migrações são aditivas e checksums aplicados não mudam. Não recriar volume ou usar o banco principal para limpar dados de teste.
- Sem saldo não há sucesso fictício. Registrar por fonte se o aceite foi de contrato, integração local ou chamada real.
- API web não processa job com tarefa solta em memória/`after()`. O worker é um processo independente.
- Instruções de páginas, datasets e modelos são dados não confiáveis, sem autoridade para alterar orçamento, permissões ou executar ferramentas.
- Comandos shell prefixados com `rtk`, PowerShell sem login; conferir documentação instalada do Next antes de mudanças de rota/UI. Branch atual: `codex/prospecting`; main publicada continua em `178cbf9`.

## Review Focus

1. Resposta perdida entre start remoto e persistência do run ID: retomar sem duplicar run cobrável. Testes atribuídos à T3 e T5.
2. Revogação, troca de workspace ou lease vencida enquanto a resposta chega: nenhuma escrita tardia autorizada pela condição antiga. Testes T1, T2, T5 e T6.
3. Empresas diferentes com telefone/e-mail/domínio compartilhado e duas buscas simultâneas: evitar fusão falsa e duplicação por corrida. Testes T2.
4. Site com redirect para rede privada, DNS rebinding ou instrução maliciosa: não acessar rede interna nem dar autoridade ao conteúdo. Testes T4 e T5.
5. Confiança ausente/alta com pouca evidência e texto humano alterado durante job: saída pendente e aplicação em conflito, sem gerar fato ou sobrescrever edição. Testes T4, T5 e T6.

## Contratos compartilhados e organização

Tipos em `src/domain/prospecting.ts`; validação Zod no servidor. Funções de domínio permanecem livres de `server-only`. `DemoJob` e `DemoState.jobs` continuam demonstrativos; jobs reais ficam em tabelas/DTOs próprios.

```ts
type JobState = 'queued'|'running'|'waiting_provider'|'needs_reconciliation'|
  'cancelling'|'cancelled'|'completed'|'partial'|'failed';
type ModuleId = 'email'|'phone'|'website'|'summary'|'deep'|'validateEmail'|'registry'|'qualify';
type Destination = {mode:'new';name:string}|{mode:'existing';listId:string};
type JobInput =
  | {kind:'generation';source:'MAPS'|'WEB'|'CNPJ'|'APOLLO';destination:Destination;
     filters:Record<string,string>;limit:number;dedupScope:'list'|'workspace'}
  | {kind:'qualification';listId:string;leadIds:string[];modules:ModuleId[];
     summaryPolicy:'all'|'fits';escalation:'off'|'ambiguous'};
type Review = {token:string;expiresAt:string;input:JobInput;warnings:string[];
  blockers:string[];profileVersion:string;usage:UsageEstimate[]};
type JobLease = {workspaceId:string;jobId:string;actorId:string;token:string;
  expiresAt:string;fence:number};
type Evidence = {id:string;url:string;fetchedAt:string;text:string;hash:string;truncated:boolean};
type Decision = {model:'typesafe/jev-1.13';verdict:'fits'|'does_not_fit'|'insufficient_evidence';
  confidence:number|null;probabilities:Record<string,number>;criteria:Record<string,number>;
  evidenceIds:string[];usage:ProviderUsage};
type Generation = {model:string;summary:string;evidenceIds:string[];usage:ProviderUsage};
```

`UsageEstimate` tem `provider`, `unit`, `maxUnits`, `estimatedUsd:number|null` e `pricingSource:string|null`. `ProviderUsage` tem `provider`, `operationId`, unidades/tokens conhecidos, `costUsd:number|null` e `costKind:'reported'|'estimated'|'unknown'`. Ausência não vira zero. `JobView` contém ID, tipo/fonte/estado/destino, criador, datas, revisão, contadores e erro sanitizado; nunca credenciais/corpo bruto. `Page<T>={items:T[];nextCursor:string|null}` usa cursor opaco validado e ordenação estável.

`Candidate` é uma empresa normalizada ainda não inserida: `sourceRef`, nome, campos opcionais compatíveis com `Lead`, fatos cadastrais, contatos e referências de evidência. `CandidatePage={receiptId:string;candidates:Candidate[];nextCursor:string|null;exhausted:boolean;rawCount:number;rejected:{sourceRef?:string;reason:string}[];usage:ProviderUsage}`. `IngestCounts` tem números `found,inserted,duplicates,rejected,pending`. `RemoteRun={provider:'apify';runId:string;datasetId:string|null;profileId:string;build:string;operationId:string}`; `RemoteState` contém run atualizado e status `ready|running|succeeded|failed|cancelling|cancelled`, erro sanitizado opcional. `ModuleResult` tem `module`, `status:'succeeded'|'skipped'|'failed'|'pending_review'`, alterações propostas, base dos campos, razões codificadas, fontes e uso. `JobItemView` expõe resultado sanitizado, não HTML bruto. `ResolveDns` é função injetável `(hostname:string)=>Promise<{address:string;family:4|6}[]>`.

A nova API é `/api/prospecting`: `GET /capabilities`, `POST /prepare`, `POST /jobs`, `GET /jobs`, `GET /jobs/[id]`, `GET /jobs/[id]/items`, `POST /jobs/[id]/cancel`, `POST /jobs/[id]/apply`. Todas exigem sessão/principal e `x-cadence-workspace`; POST também valida origem e JSON até 2 MB. Params dinâmicos são Promise no Next instalado. Responses privadas usam `cache-control:no-store`.

Configuração de operação em variáveis server-only: `CADENCE_RUNTIME_MODE=local|hosted`, `PROSPECTING_ENABLED=false`, `PROSPECTING_WORKSPACE_DAILY_UNITS`, `PROSPECTING_GLOBAL_CONCURRENCY=1`, `APIFY_TOKEN`, `APIFY_MAPS_ACTOR/BUILD`, `APIFY_WEB_ACTOR/BUILD`, `APIFY_CNPJ_ACTOR/BUILD`, `APIFY_MAX_CHARGE_USD`, `APOLLO_API_KEY`, `APOLLO_MAX_PAGES`, `OPENROUTER_API_KEY`, `JEV_MODEL=typesafe/jev-1.13`, `CODEX_LOCAL_ENABLED=false`, `CODEX_TEST_WORKSPACE_IDS`, `CODEX_BINARY`, `CODEX_MODEL`, `WORKER_DATABASE_URL`, `TEST_WORKER_DATABASE_URL`. `PROSPECTING_WORKSPACE_DAILY_UNITS` é JSON estrito com limites independentes `candidates,apifyRuns,apolloPages,jevCalls,codexCalls`; não somar dimensões incompatíveis. Ausentes equivalem a0. Tokens/custos são medidos separadamente, estimativa não é teto garantido quando o provedor não o suporta. Sem unidades/budget/configuração válida, o recurso correspondente fica indisponível; não habilitar pelo navegador.

## T1 — Jobs confirmados, API privada e ledger

**Files:** criar `src/domain/prospecting.ts`, `src/server/prospecting/{schemas,config,review,service,http,repository,usage}.ts`, `db/migrations/006-prospecting-jobs.sql` e as oito rotas listadas; alterar `src/server/auth/permissions.ts`, `scripts/test-integration.mjs`; criar `tests/prospecting-review.test.ts`, `tests/integration/prospecting.test.ts` e `tests/integration/prospecting-helpers.ts`.

**Interfaces:** `prepareJob(p:Principal,input:unknown):Promise<Review>`; `confirmJob(p,body:{requestId:string;input:JobInput;reviewToken:string}):Promise<JobView>`; `listJobs(p,{cursor?,limit?}):Promise<Page<JobView>>`; `getJob(p,id):Promise<JobView>`; `listJobItems(p,id,page):Promise<Page<JobItemView>>`; `cancelJob(p,id):Promise<JobView>`; `reserveUsage(c,operation):Promise<void>` e `settleUsage(c,operationId,usage):Promise<void>`; `assertJobLease(c,lease:JobLease):Promise<void>` bloqueia a linha e rejeita token/fence/expiração/estado ou membership inválido. Campos de lease já existem na006; o helper de testes concede leases somente via conexão migradora de `_test`, para T2 não depender do claim de T3. Cancelamento próprio permitido ao criador; owner/admin podem cancelar qualquer job do workspace. Operador pode preparar/iniciar/aplicar dentro da política existente, sem alterar funding/configuração.

- [x] RED: `review is pure and confirmation is bound to actor workspace input and expiry`: assert preparar não cria lista/job/reserva nem chama transporte; token adulterado/outro workspace/outro usuário/expirado devolve 409/422; campos fora da whitelist, limit 501 e módulos indisponíveis são rejeitados. Run `rtk proxy node --experimental-strip-types --test tests/prospecting-review.test.ts`. Expected: FAIL módulo ausente.
- [x] RED: integração `confirm once and reserve once`: duas confirmações concorrentes com mesmo requestId/corpo devolvem mesmo job/lista, uma reserva; requestId com outro corpo devolve409. Workspace B, header antigo e operador alterando política recebem 403/409. Run `rtk npm run test:integration -- prospecting`. Expected: FAIL antes da implementação.

Asserções centrais do teste, após fixture de usuário verificado e política de teste sem rede:
```ts
const [first, retry] = await Promise.all([confirmJob(p, body), confirmJob(p, body)]);
assert.equal(first.id, retry.id);
assert.equal(await countReservations(first.id), 1);
await assert.rejects(() => confirmJob(p, changedBodyWithSameRequestId), {status:409});
```
O helper `countReservations` pertence a `tests/integration/prospecting-helpers.ts` e consulta o ledger somente no banco `_test`; `changedBodyWithSameRequestId` mantém token/requestId e altera limit. Esses helpers não são APIs do produto.
- [x] Implementar schemas estritos por fonte/módulo, valores e limites acima. Review token HMAC vincula usuário, workspace, input normalizado, revisão do workspace e versão dos perfis, TTL 10 minutos; não contém segredos. Preparar só lê configuração/banco. Confirmar revalida tudo e cria job/lista/reserva atomicamente. Perfil/revisão alterados exigem nova revisão. Sem requisito atendido, a confirmação falha sem entidades órfãs.
- [x] Migração cria `app.prospecting_job`, `app.prospecting_item`, `app.prospecting_attempt`, `app.usage_ledger`, `app.prospecting_policy` e `app.provider_slot`, com PK/FKs de workspace, FORCE RLS e índices por estado/ordem. `request_id` é único por workspace; journal de uso por operationId não pode consumir/liberar duas vezes. `provider_slot` global é acessível por funções limitadas, sem SELECT direto do runtime. Criar rota apply com validação/autorização e resposta de requisito até T5, sem falso sucesso.
- [x] GREEN: testes anteriores passam; banco `_test` recebe 006 e as migrações antigas mantêm checksums. `rtk npm run typecheck`. Expected: exit0. Commit `feat: add confirmed prospecting jobs and usage reservations`.

## T2 — Publicação de resultados, evidências e deduplicação concorrente

**Files:** criar `src/server/prospecting/{normalize,ingestion,evidence,results}.ts`, `db/migrations/007-prospecting-results.sql`, `tests/prospecting-normalize.test.ts`, `tests/integration/prospecting-results.test.ts`; alterar whitelist de integração e `src/server/workspaces/commands.ts` para manter índices de identidade em alterações manuais/importações.

**Interfaces:** `normalizeCandidate(raw,profile):Candidate`; `ingestPage(c,lease,page:CandidatePage):Promise<IngestCounts>`; `recordModuleResult(c,lease,leadId,result:ModuleResult):Promise<void>`; `loadEvidence(p,ids):Promise<Evidence[]>`. Toda escrita do worker usa `assertJobLease` de T1 na mesma transação. T1 `listJobItems` passa a ler estas projeções.

- [x] RED: normalização preserva zeros e CNPJ alfanumérico, canonicaliza domínio/e-mail/telefone sem inventar DDD e rejeita empresa sem nome. `shared contact is not a company identity`: duas empresas com telefone central ou e-mail contábil não se fundem; mesmo sourceRef/CNPJ forte é duplicado. Run `rtk proxy node --experimental-strip-types --test tests/prospecting-normalize.test.ts`. Expected: FAIL.
- [x] RED integração: dois workers importando mesmo sourceRef simultaneamente produzem um registro no escopo; mesmo ID em B não colide; escopo workspace não move lead de outra lista; escopo lista permite a cópia prevista. Lote+cursor+contagens+uso fazem rollback juntos e receiptId repetido não duplica. Falta de membership, lease vencida e fence antiga rejeitam antes da escrita. Run `rtk npm run test:integration -- prospecting-results`. Expected: FAIL.

```ts
assert.equal(first.inserted + concurrent.inserted, 1);
assert.equal(first.duplicates + concurrent.duplicates, 1);
assert.equal(replayed.inserted, first.inserted); // receipt devolve resultado gravado, sem nova inserção
assert.equal(rowsAfterReplay, rowsBeforeReplay);
```
- [x] Criar `app.lead_identity` com chave de workspace/escopo/identidade forte e backfill aditivo sem excluir dados existentes; colisões legadas são registradas para revisão. Identidades ambíguas não recebem unique indiscriminado. Atualizar esse índice na mesma transação de cadastro/edição/importação/exclusão existentes. Não adicionar campos de origem confiável ao comando público só para facilitar ingestão.
- [x] Criar `app.lead_evidence`, resultados por módulo e receipts, com FKs compostas/RLS; proveniência fora do payload editável de `Lead`. Publicar até100 por transação, incrementar `workspace_meta.revision` com as mesmas regras de lock dos comandos existentes. Sanitizar fatos e limitar dados brutos retidos; histórico/resultados têm paginação, sem colocar corpo de dataset no snapshot.
- [x] GREEN: testes de T2, T1 e regressões de comandos/RLS passam; `rtk npm run typecheck`. Expected: exit0. Commit `feat: add transactional prospecting ingestion and evidence`.

## T3 — Adaptadores Apify/Apollo e acesso mínimo do worker

**Files:** criar `src/server/prospecting/providers/{types,profiles,apify,apollo,transport}.ts`, `src/server/prospecting/{lease,worker-db}.ts`, `db/migrations/008-prospecting-worker.sql`, `scripts/provision-worker.mjs`, `tests/prospecting-providers.test.ts`, `tests/integration/prospecting-worker.test.ts`, fixtures sanitizadas em `tests/fixtures/prospecting/`; alterar `scripts/{local-env,db-migrate,test-integration}.mjs`, `.env.example` e `src/server/db/transaction.ts`.

**Interfaces:** `SourceAdapter.start(ctx,input):Promise<{kind:'remote';run:RemoteRun}|{kind:'inline';page:CandidatePage}|{kind:'uncertain';operationId:string}>`; `poll(ctx,run):Promise<RemoteState>`; `readPage(ctx,run,cursor):Promise<CandidatePage>`; `abort(ctx,run):Promise<RemoteState>`. `ctx` contém signal, operationId, perfil e credencial interna; não é DTO. `claimJob(workerId):Promise<JobLease|null>`; `heartbeat(lease):Promise<boolean>`; `withLeasedTransaction<T>(lease,fn:(c:PoolClient)=>Promise<T>):Promise<T>` usa a guarda da T1. Exportar núcleo de transação reutilizável com pool explícito, preservando a assinatura pública antiga de `withWorkspaceTransaction`.

- [x] RED providers: Maps usa nicho/local/limite; web extrai resultados orgânicos; CNPJ mapeia apenas campos suportados; Apollo usa Organizations e não assume busca gratuita. `uncertain start is never retried`: timeout de POST não gera outro start, mas leitura GET pode repetir com teto. Verificar paginação, status remoto, abort pendente, malformed JSON, 401/402/403/429 e headers sem token em URL/log/erro. Run `rtk proxy node --conditions=react-server --experimental-strip-types --test tests/prospecting-providers.test.ts`. Expected: FAIL.
- [x] RED DB: app role não consegue claim global, worker não lê auth, dois claims só entregam uma lease por job/workspace, heartbeat atrasado não renova fence antiga. Lease expirada pode retomar polling de run existente; não pode gerar start novo. Run `rtk npm run test:integration -- prospecting-worker`. Expected: FAIL.

```ts
assert.equal(uncertain.kind, 'uncertain');
assert.equal(recordedStartPosts.length, 1);
assert.equal(await heartbeat(expiredLease), false);
assert.equal(claims.filter(Boolean).length, 1);
```
- [x] Apify assíncrono: perfis com Actor/build explícitos, bearer em header, endpoints de start/run/dataset/abort no host fixo. `maxTotalChargeUsd` somente onde PPE suporta; manter limites de itens/tempo/capabilities por perfil. Mapear erros sem inventar dados. CNPJ filtros ausentes recebem indisponibilidade/pós-filtro declarado e contagem da amostra. Apollo endpoint oficial de empresas, paginação de até100, páginas limitadas pela política; nenhum enriquecimento automático. Perfis sem build/preço/capacidade conferidos não ficam live-enabled.
- [x] Provisionar `cadence_worker` NOSUPERUSER/NOBYPASSRLS e senha aleatória em `.env.local` somente se ausente; preservar valores antigos. A criação funciona no volume existente, não apenas no init do Docker. `db:migrate` provisiona antes da 008; runner `_test` valida/substitui também WORKER URL. Funções de claim com search_path fixo e PUBLIC revogado; retornam somente metadata/lease. Worker usa contexto do emissor real sob RLS; `withLeasedTransaction` trava lease, revalida membership e fence antes de cada commit. Sem sessão fake autorizando pelo cookie; a autoridade é o job confirmado e o membership atual.
- [x] GREEN: suites providers/worker/results, migrações repetidas e typecheck passam. Commit `feat: add bounded provider adapters and worker leases`.

## T4 — Extração pública, decisão JEV e geração Codex local

**Files:** criar `src/server/prospecting/extraction/{public-url,fetch-page,parse-page,contacts}.ts`, `src/server/prospecting/ai/{types,jev,codex,policy,schemas}.ts`, `tests/{prospecting-extraction,prospecting-ai}.test.ts`, `tests/fixtures/prospecting/{html,jev,codex}/`; alterar package files e `.env.example`.

**Interfaces:** `fetchPublicPage(url,options:{signal:AbortSignal;resolve:ResolveDns}):Promise<Evidence>`; `extractContacts(evidence):ContactFacts`; `decide(ctx,{criteria,evidence,facts}):Promise<Decision>`; `generate(ctx,{task:'summary'|'second_opinion',evidence,criteria}):Promise<Generation>`; `chooseNextModule(input,results,policy):ModuleId|null`. Transporte HTTP/DNS/processo injetável em testes. Não criar interface única fingindo que JEV gera texto.

- [x] RED extração: impedir loopback/privado/metadata, IPv4-mapped IPv6, hostname numérico normalizado, DNS misto público+privado, redirect interno e rebinding. Resolução aprovada é fixada na conexão, mantendo hostname/SNI/TLS. Rejeitar credentials na URL, scheme/file, porta fora de80/443, corpo>1MB, MIME incompatível, timeout/redirect loop; máximo3páginas por domínio e até3redirects. HTML com script/instruções não executa nada. Run `rtk proxy node --conditions=react-server --experimental-strip-types --test tests/prospecting-extraction.test.ts`. Expected: FAIL.
- [x] RED IA: assert request para `/api/alpha/decisions`, modelo exato e estado+perguntas; fixtures Choice/Noul/Score, labels inválidos, confidence ausente, probabilities inválidas e usage ausente; saída pendente quando não há fonte. Alta confiança sem evidência não produz qualificado. Não interpretar score como probability. Run `rtk proxy node --conditions=react-server --experimental-strip-types --test tests/prospecting-ai.test.ts`. Expected: FAIL.
- [x] RED Codex: processo falso recebe argv sem shell interpolation, stdin com dados, schema de saída e env sem segredos do app. Hosted/workspace não autorizado/opt-in ausente não executam processo. Quota, timeout, cancelamento, output>1MB/JSON inválido e tentativa de tool call falham sem sucesso fictício. Gerar resumo para todos só se selecionado; por padrão sem módulo summary não há chamada. Modelo alternativo nunca entra por fallback implícito.

```ts
assert.equal(decision.model, 'typesafe/jev-1.13');
assert.equal(decision.confidence, null); // fixture sem confidence
assert.equal(withoutEvidence.verdict, 'insufficient_evidence');
assert.equal(hostedRunnerCalls, 0);
assert.equal(capturedSpawnOptions.shell, false);
```
- [x] Instalar versões fixadas `rtk npm install --save-exact parse5@8.0.1 ipaddr.js@2.5.0`. Parsing remove script/style e preserva texto/links/fonte; verificação de e-mail declara formato/DNS, não existência da caixa. IP público validado em todos os redirects, HTTP nativo com lookup fixado, 10s por página, limite de bytes após descompressão. Evidence pack até12.000caracteres com `truncated` explícito.
- [x] JEV usa fetch+Zod, Choice de aderência e critérios Noul/Score definidos; sem justificativa livre inventada. Políticas sem calibração marcam decisão sugerida/revisão; `insufficient_evidence` não escala para palpite. Guardar uso real, erro não equivale a decisão negativa. Cache por workspace/hash da evidência/versão de critérios/modelo/contrato; sem cache global entre clientes.
- [x] Codex opt-in usa executável absoluto configurado, argv array sem `shell:true`, cwd temporário fora do repo, stdin e output-schema. Flags verificadas na versão instalada: `--ignore-user-config --ephemeral --sandbox read-only`; desabilitar apps/hooks/plugins/remote_plugin/shell_tool/browser/computer/multi_agent pelas opções suportadas, `web_search="disabled"`, e instrução de responder somente JSON. Não herdar MCP/políticas do usuário nem repassar credenciais dos provedores. Não usar flags `dangerously-*`. Conferir configuração efetiva antes de habilitar; se ferramenta não puder ser desativada, declarar indisponível. Timeout120s mata árvore do processo; limpeza valida diretório temporário absoluto. Serializar globalmente pelo slot PG, não por variável de memória.
- [x] GREEN: extração/IA/provider regressions e typecheck passam. Commit `feat: add evidence extraction and hybrid AI adapters`.

## T5 — Worker retomável, qualificação revisável e reconciliação

**Files:** criar `src/server/prospecting/{worker,steps,qualification,application,reconciliation}.ts`, `scripts/prospecting-worker.ts`, `tests/integration/prospecting-pipeline.test.ts`; alterar serviço/rota apply, usage, package scripts e whitelist de integração.

**Interfaces:** `runWorkerOnce(deps,{workerId,signal}):Promise<boolean>`; `runGeneration(lease,adapters):Promise<void>`; `runQualification(lease,adapters):Promise<void>`; `applyJobResults(p,jobId,{requestId,itemIds}):Promise<{applied:number;revision:number}>`; `reconcileJob(p,id,{runId?,confirmNotStarted?:boolean}):Promise<JobView>`. Reconciliar exige owner/admin, perfil/runID compatível e ação de revisão explícita; nunca aceitar URL externa livre. Criar `POST /jobs/[id]/reconcile` e seu teste de autorização.

- [x] RED pipeline: fixture source com duas páginas, worker morre entre elas, retomada publica só página faltante; parar antes/depois do start não duplica run; heartbeat vencido impede commit atrasado. Uma página confirmada e outra falha resulta em partial com contadores preservados; receipt/uso repetidos não duplicam. Cancelar antes da fila libera reserva; durante run sinaliza cancelling e aguarda abort; não promete estorno.
- [x] RED qualification: extrair/decidir só guarda proposta; apply confirmado atualiza selecionados atomicamente, clique/retry reusa resultado. Editar campo humano/contexto entre preparação e apply produz409 com conflito e mantém propostas. Critério/contato faltante vira skipped/pending, módulo com erro não altera campos. Membership removido impede publicação/aplicação; limpeza/cancelamento do run iniciado ainda pode ser reconciliado sem devolver dados ao removido. Run `rtk npm run test:integration -- prospecting-pipeline`. Expected: FAIL.

```ts
assert.equal(partialJob.state, 'partial');
assert.equal(startPostsAfterRecovery, 1);
await assert.rejects(() => applyJobResults(p, jobId, selection), {status:409});
assert.equal(leadAfterConflict.summary, humanEditedSummary);
```
- [x] Loop com claim/lease30s/heartbeat10s, timeout do passo e backoff limitado; nunca manter transação/row lock durante chamada de rede/CLI. Journal registra intenção antes de start; resposta ambígua vira needs_reconciliation, não novo POST. Reconciliação pode vincular run existente ou confirmar explicitamente ausência; leitura do run verifica perfil/dataset e não sai do host fixo. Lease/fence e budget conferidos ao agendar cada chamada e ao persistir resposta.
- [x] Integração dos módulos: fatos/cadastros/contatos e saída JEV ficam em resultados por lead; resumo só sob política selecionada. Escala generativa é limitada aos ambíguos com evidência, dentro da reserva, com segundo parecer também revisável. Aplicação compara valores-base por campo e versão do contexto aprovado; mudança em item selecionado rejeita lote inteiro e lista conflitos. Resultado desconhecido nunca aprovado por default.
- [x] Script usa `node --conditions=react-server --experimental-strip-types`, carrega `.env.local`, valida config e fecha pools no shutdown. `rtk npm run worker` mantém processo; `--once` executa um passo. Retomar sem refazer cobrança mesmo após SIGTERM/restart. Saídas operacionais sanitizadas.
- [x] GREEN: pipeline+integração completa, pure tests e typecheck. Commit `feat: run recoverable prospecting and qualification pipelines`.

## T6 — Gerador, qualificador, histórico e status de integrações

**Files:** criar `src/client/prospecting-client.ts`, `src/modules/prospecting/{job-review,job-progress,job-history,job-results,qualification-review,provider-status}.tsx`, `src/app/(app)/executions/[id]/page.tsx`; alterar generator/qualifier/source-picker/cnpj-filters, integrations, `src/app/(app)/executions/page.tsx`, reports e shell quando necessário; criar `tests/prospecting-client.test.ts`.

**Interfaces:** `createProspectingClient({workspaceId,transport}):{prepare,confirm,list,get,items,cancel,apply,reconcile,dispose}` usa endpoints T1/T5 e callbacks assíncronos. `useProspectingJob(id)` faz polling só enquanto ativo; respostas de workspace/geração antiga são ignoradas. O repositório demonstrativo continua separado; não usar dados fictícios no caminho server.

- [x] RED cliente: preparar/cancelar revisão não chama `/jobs`; clique duplo compartilha Promise/requestId; falha não fecha modal nem comunica sucesso; start incerto procura mesmo requestId, sem segundo job. Abort/dispose impede publicação tardia; 401/403/WORKSPACE_CHANGED limpa superfície conforme provider atual. Run `rtk proxy node --experimental-strip-types --test tests/prospecting-client.test.ts`. Expected: FAIL.

```ts
assert.equal(postsBeforeConfirmation, 0);
assert.equal(confirmationA, confirmationB); // mesma Promise em curso
assert.equal(confirmationRequestIds.size, 1);
assert.equal(publishedAfterDispose, 0);
```
- [x] UI mantém layout e formulários da referência. Gerador server prepara/revisa/confirma e acompanha job, com destino/capabilities; demo mantém simulação explicitamente marcada. Qualificador apresenta módulos disponíveis, fontes, anterior/proposto, conflitos e botão Aplicar; nunca aplica pela simples resposta da IA. Exibir pós-filtro/amostra/sem crédito/sem chave/sem worker sem mensagens enganosas.
- [x] Histórico lista jobs reais paginados e separa entradas demo legadas. Detail mostra progresso, consumo por provedor, partial/cancelling/reconciliation, erro e ações autorizadas. Reconciliar é visível só para owner/admin. Atualização de progresso não faz refresh global contínuo que descarte edição; após nova revisão de domínio, conservar o bloqueio contra overwrite do marco02.
- [x] Status de integrações mostra se configuração existe e seus requisitos, nunca chaves; não solicitar token em modal sem fluxo seguro. Apollo empresa declara requisito próprio; inbox/cadências continuam sem envio. Dashboard mantém métricas coerentes com contatos persistidos.
- [x] GREEN: cliente/regressões/typecheck; navegador percorre fonte sem credencial, review sem efeito, job fixture de QA explícito, parcial, cancelamento e revisão/aplicação com conflito. Fake provider só no harness de teste privado, nunca como fallback de conta real. Responsividade desktop/celular e console inspecionados. Commit `feat: connect prospecting workflows to live job APIs`.

## T7 — Harness de avaliação, smokes opt-in e aceite documentado

**Files:** criar `scripts/{evaluate-prospecting,smoke-prospecting}.mjs`, `tests/prospecting-evaluation.test.ts`, `docs/validation/03-prospecting.md`, `docs/validation/03-provider-matrix.json`; atualizar README, roteiro, smoke-routes e `.env.example`.

**Interfaces:** `evaluatePredictions(gold,predictions):EvaluationReport` em `src/domain/prospecting-evaluation.ts`, com matriz de confusão/precisão/recall/abstenção, taxa de escala, custo conhecido/desconhecido e p50/p95; `loadEvaluationSet(path)` rejeita mistura entre empresas/domínios de ajuste/teste. CSV/JSON de verdade humana não é gerado por LLM como gabarito.

- [x] RED: fixture pequena com um falso positivo/falso negativo/abstenção/uso desconhecido produz métricas exatas; split por mesmo domínio é rejeitado; custo faltante não vira0. Run `rtk proxy node --experimental-strip-types --test tests/prospecting-evaluation.test.ts`. Expected: FAIL. Implementar harness, validar fórmulas e passar.

```ts
// gold: fits,fits,does_not_fit,does_not_fit; saída: fits,does_not_fit,fits,insufficient_evidence
assert.equal(report.fits.precision, 0.5);
assert.equal(report.fits.recall, 0.5);
assert.equal(report.abstentionRate, 0.25);
assert.equal(report.hasUnknownCost, true);
```
`EvaluationReport` expõe essas propriedades, `knownCostUsd`, cobertura, taxa de escala e latências; custo total não é apresentado como completo se `hasUnknownCost`.
- [x] Dataset piloto de100 casos é formato/harness e guia de rotulagem previstos no estudo. Sem exemplos rotulados ou API/saldo, registrar “avaliação empírica pendente”, não fabricar os100 resultados ou limiar. Capturar versão/modelo/prompt/evidências e separar ajuste/teste nas execuções futuras.
- [x] Smoke real é opt-in, exige fonte explícita, workspace de QA, limite de registros/chamadas e budget quando aplicável. Sem flags retorna SKIPPED/requirement, sem erro de sucesso. Codex smoke sintético local no máximo uma chamada/120s, sem acesso a arquivos pessoais; sem usar outros provedores silenciosamente. Apify/Apollo/JEV só com credencial e autorização/limite presentes. Não comprar créditos nem ativar assinatura.
- [x] `rtk npm test`, `rtk npm run test:integration`, `rtk npm run typecheck`, `rtk npm run build` e `rtk proxy node scripts/smoke-routes.mjs`: Expected exit0. Inspecionar outputs; integração exclusivamente `_test`. Reiniciar worker/DB e reler resultados/checkpoints. Registrar screenshots próprias e flows A/B sem dados reais de clientes.
- [x] Matriz distingue cada fonte e módulo: contrato offline, PG/UI, smoke real, bloqueio externo e precisão avaliada. Descrever como configurar chaves localmente sem chat/log/Git; comandos de execução/retomada/cancelamento. Atualizar roteiro sem marcar paridade integral, IA de cadências ou scheduler como prontos.
- [x] Revisão independente única da branch conforme execução nativa; achados críticos/importantes em um passe RED→GREEN e suíte verde; menores/demais decisões no registro. Commit `test: verify prospecting recovery isolation and hybrid AI contracts`.

## Auto-revisão e handoff

Cobertura: spec§3 T3/T6; §4 T1/T5/T6; §5 T4; §6–7 T4/T5/T7; §8 T1/T3/T5; §9 T1/T2/T3; §10 T7. Os cinco riscos de revisão têm testes atribuídos acima. T1 define DTO/API/uso/guarda de lease; T2 ingere sem depender de código futuro; T3 fornece adapters/claim/heartbeat; T4 coleta/decide/gera; T5 executa/aplica; T6 consome DTOs; T7 mede e documenta. Nenhum task depende de retornar um snapshot com todos os dados brutos de job.

Defaults operacionais adicionais do plano: review10min, lease30s, heartbeat10s, página web10s, CLI120s, até3redirects e máximo1MB de saída CLI. São limites de segurança/retomada, não promessa de throughput. Thresholds de aceitação JEV só após calibração; antes, resultados são propostas revisáveis.

O plano não habilita smokes pagos por possuir adaptadores, nem apresenta fixture como produção. Não altera o login OAuth do usuário. Métodos, enums e assinaturas acima são a referência para os consumidores; desvios durante execução exigem registro no ledger.

Plano aprovado pelo usuário e executado nativamente. T1–T7 concluídas e uma revisão independente realizada, com oito correções importantes verificadas. Aceite local/contratual:71 testes unitários,39 de integração, typecheck/build e48 rotas. Chamadas reais e avaliação empírica continuam pendentes de credenciais/saldo/dataset humano. Desvios e menor adiado: docs/validation/03-execution-record.md e03-review.md. Integração da branch ainda depende da escolha do usuário.

## Referências técnicas verificadas

- Next instalado: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` e `02-guides/environment-variables.md`.
- [Apify Run Actor](https://docs.apify.com/api/v2/actors-runs-post), [limites de start](https://docs.apify.com/api/client/js/reference/interface/ActorStartOptions) e schemas de Actors no estudo/descoberta.
- [Apollo Organization Search](https://docs.apollo.io/reference/organization-search).
- [JEV Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request), [confidence](https://docs.typesafe.ai/confidence) e [classificação com avaliação](https://openrouter.ai/docs/cookbook/evaluate-and-optimize/jev-classification).
- [Codex não interativo](https://learn.chatgpt.com/docs/non-interactive-mode), [configuração](https://learn.chatgpt.com/docs/config-file/config-basic) e [exemplo de configuração](https://learn.chatgpt.com/docs/config-file/config-sample). Ajuda/feature flags também conferidos no CLI local, sem inferência.
- Metadados de `parse5@8.0.1` e `ipaddr.js@2.5.0` conferidos via `npm view`, repositórios dos mantenedores e licença MIT; não instalados na etapa de planejamento.
