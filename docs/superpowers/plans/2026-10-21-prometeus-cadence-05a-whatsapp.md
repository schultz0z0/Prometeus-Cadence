# Marco 05A — WhatsApp Meta/Twilio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Execução nativa nesta conversa já escolhida pelo usuário. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar contas próprias Meta/Twilio pelo app e executar mensagens confirmadas, cadências e inbox reais com isolamento por workspace.

**Architecture:** Configuração, ingestão autenticada e despacho são serviços separados sobre o PostgreSQL existente. Publicações imutáveis alimentam inscrições e uma outbox própria, com claims/fencing, intenções duráveis e recibos idempotentes; conversa recebida não depende de lead. Adaptadores não escolhem tenant, autorização, fallback ou conteúdo.

**Tech Stack:** Node24.16, TypeScript5.9, Next16.4.2/React19.3, Zod4.6.7, pg8.23.1, PostgreSQL18.6/Docker; crypto/fetch/Intl nativos e SDK oficial `twilio` para assinaturas. Fixar a versão resolvida do SDK no package.json/package-lock, sem outro serviço/banco.

**Spec:** [desenho05A](../specs/2026-10-21-prometeus-cadence-05a-whatsapp-design.md), aprovado pelo usuário em21/10/2026; pesquisa em `docs/research/2026-10-21-meta-twilio-whatsapp-study.md`. Base funcional `0a2b5a7`, documentação `63d54af`; branch atual `codex/whatsapp-05-design`. Ler ambos os documentos antes da execução.

## Global Constraints

- “Nenhuma edição de `.env` por cliente, chave WhatsApp global compartilhada ou intervenção manual no banco para ativar a conexão.” Ambiente contém somente infraestrutura/chaves de cifra e origem pública controlada.
- “JEV nunca opera sozinho; conteúdo de IA é revisável.” Preservar03B/04, sem inferências pagas nesta implementação.
- “QR, Z-API e conectores não oficiais não entram no 05A.” Embedded Signup, e-mail05B, SDR autônomo, LinkedIn e processamento completo de mídia ficam fora.
- “Meta: […] versão candidata fixada `v26.0`, sujeita ao aceite autenticado.” Sem `latest`, downgrade silencioso ou endpoints arbitrários.
- “Limitar callback a 1 MiB antes do parse”; “Metadados técnicos detalhados de ingestão expiram em 90 dias”; “Respostas REST limitadas a 2 MiB e chamadas com timeout de até 30 segundos.”
- “Texto livre somente com janela válida de 24 horas após a última mensagem recebida.” Telefone prospectado não é opt-in; envio/read/delivery/redelivery não renovam janela.
- “Retry automático só quando há prova de que não houve aceitação: no máximo duas tentativas adicionais, backoff de pelo menos 30 segundos e respeito ao Retry-After”. Estado incerto bloqueia novo POST, inclusive por outro provedor.
- “Não instalar Redis, broker ou outro banco para este bloco.” Outbox separada de prospecting_job; sem leads/listas fictícios.
- “Migrações são aditivas após 020, sem modificar checksums anteriores ou recriar volumes.” Testes somente `_test`; não ativar campanhas por migração/startup.
- Salvar, verificar credenciais e sincronizar templates não enviam. Teste, publicação e resposta manual exigem revisão/confirmação e autoridade atual. Não registrar credenciais, OAuth ou corpos sensíveis em logs.
- Aceite externo Meta é etapa separada: contato de teste autorizado, conteúdo/teto confirmados e HTTPS público restrito. Não usar For Derm Clinic. Twilio offline não equivale a aceite externo. Marco05 integral depende também do05B.
- Shell com `rtk`, `login:false`. Antes de código Next, ler guias locais de route handlers, server/client components e forms; `route.ts` usa `params:Promise<...>`, runtime Node e respostas privadas `no-store`.

## Review Focus

1. Credencial rotacionada ou papel revogado entre prévia e despacho: impedir novo envio, mas preservar recibo tardio de tentativa existente (T2/T8).
2. Callback repetido, adulterado, fora de ordem ou sem telefone: autenticar escopo, não duplicar/reabrir janela nem inventar contato (T4/T5).
3. POST aceito com resposta perdida/reinício: estado incerto, quota reservada e nenhum retry/fallback cego (T8).
4. Duas cadências e resposta manual disputando remetente: teto agregado e interrupção por resposta/opt-out prevalecem na checagem imediatamente anterior ao POST (T5/T8).
5. Janela expira ou template muda depois da confirmação; DST/downtime: bloquear conteúdo inválido e nunca disparar etapas futuras em rajada (T1/T6/T8).

## Arquivos e responsabilidades

| Unidade | Arquivos novos principais | Responsabilidade |
| --- | --- | --- |
| Contratos | `src/domain/{whatsapp,whatsapp-policy,cadence-runtime}.ts` | DTOs sem segredos, elegibilidade e estados publicados |
| Configuração | `src/server/channels/{schemas,crypto,repository,connections,templates,http}.ts` | persistência cifrada, verificação, catálogo e APIs |
| Provedores | `src/server/channels/providers/{contracts,http,meta,twilio}.ts` | transporte limitado, ativos, payloads, normalização e consulta por ID |
| Entrada | `src/server/channels/{ingress-db,webhook-auth,webhooks,events}.ts` | assinatura, vínculo de conta, recibo e aplicação idempotente |
| Execução | `src/server/messaging/{repository,consent,publication,schedule,outbox,worker-db,lease,dispatch,receipts,usage,reconciliation}.ts` | autorização, agenda, tentativas e orçamento agregado |
| Inbox | `src/server/messaging/{inbox,replies,http}.ts` | consultas, leitura, vínculo revisado e resposta confirmada |
| Cliente | `src/client/{channel-client,messaging-client,messaging-flow}.ts` | transporte por workspace, cancelamento e confirmações idempotentes |
| Telas | `src/modules/settings/{whatsapp-settings,whatsapp-connection-form}.tsx`, `src/modules/cadences/{publication-review,whatsapp-step-binding}.tsx`, `src/modules/messages/{conversation-list,conversation-thread,reply-review}.tsx` | conexão, revisão de ativação e inbox real |
| Banco | `db/migrations/{021-whatsapp-connections,022-channel-verification,023-whatsapp-inbox,024-cadence-outbox,025-materialization-role-guard,026-manual-outbox,027-messaging-dispatch}.sql` | RLS/FKs, papéis mínimos, funções restritas e índices |
| Operação | `scripts/{provision-channel-roles.mjs,messaging-worker.ts,messaging-maintenance.ts,smoke-whatsapp.ts}` | provisionamento local, worker, retenção e aceite explícito |

Modificações existentes e testes constam de cada tarefa. Helpers PG novos em `tests/integration/whatsapp-helpers.ts` usam identidades verificadas e fixtures; nunca credenciais reais. Todas as novas suites PG entram na allowlist de `scripts/test-integration.mjs` na tarefa que as introduz.

## Contratos compartilhados

T1 define os tipos usados abaixo em `whatsapp.ts`/`cadence-runtime.ts`; IDs são strings opacas, datas ISO UTC, relógio injetável. `Db` significa `PoolClient` e `Principal` é o tipo existente; argumentos HTTP externos continuam `unknown` até schema fechado. Funções que recebem `Db` não abrem transação/rede por conta própria.

- `Provider='meta'|'twilio'`; `ConnectionView={id,provider,name,revision,state,externalAccountId:string|null,hasSecrets:boolean,verification:{credentials:boolean;challenge:boolean;inbound:boolean},senders:SenderView[]}`. `state='pending'|'credentials_verified'|'awaiting_webhook'|'ready'|'attention'|'disconnected'`; ausência é lista vazia. DTO não contém segredo, cifra ou fingerprint.
- `SenderView={id,connectionId,provider,address:string|null,externalId,identityScope,revision,ready:boolean,dailyLimit:number|null}`; `Identity={scope:string;externalId:string;phone:string|null}`. Scope inclui provedor e conta/portfolio verificado, sem merge global de BSUID.
- `TemplateView={id,connectionId,provider,remoteId,name,language,status,revision,hash,parameters:TemplateParameter[]}`; `TemplateParameter={component:'header'|'body'|'button';key:string;type:'text'|'currency'|'date_time'|'media'}`. `status='approved'|'pending'|'rejected'|'paused'|'disabled'|'unknown'`; neste piloto somente parâmetros textuais suportados podem ser enviados; demais aparecem indisponíveis, sem remover componentes. `OutboundContent={kind:'text';text:string}|{kind:'template';templateId:string;templateRevision:number;variables:Record<string,string>}`. Separar deste catálogo os templates locais atuais de redação.
- `ConsentInput={identityId,purpose,source,occurredAt,evidence}`; `SendPolicyInput={now,lastInboundAt:string|null,purpose:'service'|'campaign'|'test',hasOptIn:boolean,suppressed:boolean,senderReady:boolean,content:OutboundContent,template:TemplateView|null}`; `SendPolicyResult={allowed:boolean;blockers:string[]}`.
- `Review<T>={token,expiresAt,snapshot:T,blockers:string[]}`. `PublicationInput={cadenceId,expectedRevision,senderId,bindings:Record<string,OutboundContent>,leadIds:string[]}`; `PublicationReview=Review<PublicationSnapshot>`; `PublicationSnapshot={cadence:Cadence;draftRevision:number;recipients:{leadId:string;identityId:string;identity:Identity;factsHash:string}[];bindings:Record<string,OutboundContent>;sender:SenderView;connectionRevision:number;contextVersion:number;aiRouteRevision:number;workspaceDailyLimit:number;senderDailyLimit:number;actorId:string}`. Revisões são obtidas no servidor, não escolhidas pelo browser. `PublicationView={id,cadenceId,revision,state:'active'|'paused'|'completed',enrollmentCount}`.
- `PreparedSend={connectionId,connectionRevision,senderId,identity:Identity,content:OutboundContent,purpose:'service'|'campaign'|'test'}`; `SendOutcome={kind:'accepted';remoteId:string;acceptedAt:string}|{kind:'not_accepted';code:string;retryable:boolean;retryAfterMs:number|null}|{kind:'uncertain';code:string}`. `Receipt={attemptId,outcome:SendOutcome,costUsd:number|null,costKind:'reported'|'unknown'}`.
- `WebhookEvent` união discriminada inbound/status/template/unknown: todos têm `dedupKey,accountId,senderExternalId:string|null,occurredAt:string|null`; inbound acrescenta `remoteId,identity:Identity,text:string|null,mediaKind:string|null`; status acrescenta `remoteId,status,errorCode:string|null`; template acrescenta remoteId/status. `AuthenticatedBatch={connectionId,credentialRevision,bodyHash,receivedAt,events:WebhookEvent[]}` é produzido exclusivamente após autenticação.
- `DispatchLease={workspaceId,messageId,attemptId,token,fence,expiresAt}`; `MessageView={id,conversationId,direction:'inbound'|'outbound',text:string|null,mediaKind:string|null,state,remoteId:string|null,createdAt}`; `ConversationView={id,senderId,identity:Identity,leadId:string|null,unread:number,lastMessageAt:string|null}`. Estado de envio e evidências delivered/read são campos independentes no armazenamento.

### Task 1: Política de envio e agenda determinísticas

**Files:** criar os três arquivos de domínio do mapa, `src/server/messaging/schedule.ts`, `tests/{whatsapp-policy,cadence-dispatch-schedule}.test.ts`; consumir `src/domain/{model,cadence,schedule}.ts` sem alterar gerações04.

**Interfaces:** produz os tipos compartilhados e `evaluateSendPolicy(input:SendPolicyInput):SendPolicyResult`; `nextStepAt(input:{anchorAt:string;delayDays:number;now:string;timezone:string;weekdays:number[];sendTime:string;skipHolidays:boolean;holidayDates:string[]|null}):string`. Reutiliza `wallTimeToUtc(date,time,timezone)` existente. Dias corridos no fuso preservam a hora local da âncora antes da janela permitida.

- [x] RED: escrever testes `exact_24h_is_closed`, `future_inbound_does_not_authorize`, `campaign_requires_evidence`, `template_revision_and_components_match`, `dst_gap_overlap`. Asserções: `assert.equal(at24h.allowed,false)`; `assert.equal(futureInbound.allowed,false)`; `assert.equal(campaignWithoutOptIn.allowed,false)`; template incompatível/variável vazia bloqueiam. DST resolve primeiro instante válido no gap/primeira ocorrência no overlap; feriado sem calendário gera erro.
- [x] Rodar `rtk proxy node --experimental-strip-types --test tests/whatsapp-policy.test.ts tests/cadence-dispatch-schedule.test.ts`; esperado FAIL por módulos ausentes.
- [x] Implementar schemas/tipos e funções puras. Primeiro delay ancora na inscrição; demais na aceitação anterior, nunca na entrega. Configurações legadas de alternância de contato/distribuição/reengajamento sem execução definida bloqueiam publicação, sem serem ignoradas.
- [x] Repetir comando e `rtk npm run typecheck`; esperado PASS/exit0. Commit `feat: define WhatsApp policy and cadence scheduling contracts`.

### Task 2: Persistência de conexões, propriedade e cifra

**Files:** criar 021, `src/server/channels/{crypto,schemas,repository}.ts`, `scripts/provision-channel-roles.mjs`, `tests/channel-crypto.test.ts`, `tests/integration/{whatsapp-storage.test,whatsapp-helpers}.ts`; modificar `scripts/{local-env.mjs,db-migrate.mjs,test-integration.mjs}`, `src/server/auth/permissions.ts`.

**Interfaces:** `CredentialAAD={workspaceId:string;connectionId:string;provider:Provider;revision:number}`; `EncryptedCredential={keyId:string;iv:string;tag:string;ciphertext:string}`; `encryptCredential(value:Record<string,string>,aad:CredentialAAD):EncryptedCredential`; `decryptCredential(value:EncryptedCredential,aad:CredentialAAD):Record<string,string>`. `readConnections(p:Principal):Promise<ConnectionView[]>`, `saveConnection(p:Principal,input:unknown):Promise<ConnectionView>`. Schemas exportam SaveConnectionInput com requestId/expectedRevision/id opcional/provider/name e credenciais discriminadas conforme spec §3; SenderLimitsInput com requestId/expectedRevision/workspaceDailyLimit/senderId/senderDailyLimit, limites inteiros positivos. Ausência não significa ilimitado.

- [x] RED unit/PG: `assert.throws(()=>decryptCredential(cipher,foreignAAD))`; nonces distintos; chave ausente bloqueia; readback sem token. RLS A/B, operator sem gestão, blank preserva segredo, replay divergente409, ID externo digitado não reserva propriedade. Rodar `rtk proxy node --experimental-strip-types --test tests/channel-crypto.test.ts` e `rtk npm run test:integration -- whatsapp-storage`; esperado FAIL.
- [x] Implementar AES-256-GCM, nonce aleatório12bytes, chave32bytes base64, tag16bytes. Servidor usa `CHANNEL_KEYRING_JSON` (keyId→base64) e `CHANNEL_ACTIVE_KEY_ID`; gerar apenas infraestrutura local ausente, sem imprimir valores. Rotação mantém chaves antigas para decifrar e invalida provas da revisão anterior.
- [x]021: connection, credential, sender, remote_template, verified_account_ownership e limites/auditoria. Tenant/RLS/FKs compostas; app comum não tem SELECT de segredo, apenas funções administrativas restritas. Ownership único de conta/remetente somente após prova remota e revisão válida; desconexão preserva histórico e transferência exige liberação administrativa explícita, nunca simples save.
- [x] Acrescentar permissões `channels.manage`, `cadences.publish`, `messages.reply`, `consents.manage`; operator recebe apenas messages.reply além das atuais. SQL revalida papel atual. Provisionar `cadence_ingress`/`cadence_dispatcher` NOSUPERUSER/NOBYPASSRLS/NOINHERIT sem CRUD amplo. URLs `INGRESS_DATABASE_URL`, `DISPATCH_DATABASE_URL` e TEST equivalentes; migrador provisiona papéis antes das migrations, runner aceita só `_test`.
- [x] Repetir focais + suites migrations/tenancy/memberships e typecheck; esperado PASS. Commit `feat: persist encrypted tenant-owned WhatsApp connections`.

### Task 3: Adaptadores Meta/Twilio e transporte limitado

**Files:** criar `src/server/channels/providers/{contracts,http,meta,twilio}.ts`, `tests/whatsapp-providers.test.ts`; modificar package.json/package-lock para SDK Twilio oficial.

**Interfaces:** `ProviderAdapter` define `verifyAssets(config:ProviderConfig):Promise<VerifiedAssets>`, `listTemplates(config:ProviderConfig):Promise<TemplateView[]>`, `sendOnce(config:ProviderConfig,send:PreparedSend,callbackUrl:string):Promise<SendOutcome>`, `lookupMessage(config:ProviderConfig,remoteId:string):Promise<SendOutcome|null>`. ProviderConfig é união server-only dos campos Meta/Twilio T2. VerifiedAssets contém conta/remetentes/capacidades verificados, sem tokens; transporte injeta `fetcher:typeof fetch`.

- [x] RED fixtures: Meta JSON/Bearer/v26.0/telefone dentro da WABA; Twilio form/From explícito/ContentSid+ContentVariables sem Body; conta/pool divergentes rejeitam. `assert.equal(timeoutAfterPost.kind,'uncertain')`; payload correto não contém Body com template. Rodar `rtk proxy node --experimental-strip-types --test tests/whatsapp-providers.test.ts`; esperado FAIL.
- [x] Implementar hosts/path fixos, redirects desabilitados, resposta por stream≤2MiB, abort≤30000ms e logs redigidos. Paginação limitada informa catálogo incompleto. Meta valida WABA/PhoneNumber/permissões; Twilio valida conta e sender habilitado. MessagingService opcional exige vínculo ao pool e From explícito. Autenticação AccountSID/AuthToken é seleção explícita, não fallback.
- [x] not_accepted exige rejeição comprovada; auth/config inválida não retry. Timeout/5xx sem prova são uncertain. Rate limit comprovadamente rejeitado pode fornecer RetryAfter. Consulta por ID só quando recurso existir; não inventar busca Meta nem idempotência de POST. URLs remotas não ampliam allowlist de hosts.
- [x] Repetir teste + typecheck; esperado PASS. Commit `feat: implement bounded Meta and Twilio WhatsApp adapters`.

### Task 4: Ciclo de conexão, catálogo e autenticação dos callbacks

**Files:** criar `src/server/channels/{connections,templates,webhook-auth,ingress-db}.ts`, `tests/webhook-auth.test.ts`, `tests/integration/whatsapp-connections.test.ts`. Alteração SQL posterior à aplicação de021 exige nova migration após a última existente; nunca reescrever checksum.

**Interfaces:** `verifyConnection(p:Principal,id:string,expectedRevision:number):Promise<ConnectionView>`; `syncTemplates(p:Principal,id:string,expectedRevision:number):Promise<TemplateView[]>`; `disconnectConnection(p:Principal,input:unknown):Promise<ConnectionView>`; `authenticateWebhook(request:Request,publicId:string,kind:'meta'|'twilio-messages'|'twilio-status'):Promise<AuthenticatedBatch>`; `verifyMetaChallenge(request:Request,publicId:string):Promise<string>`. Ingress resolve publicId/material de assinatura por função restrita, sem DTO de segredos.

- [x] RED: assinatura/body/conta/URI divergentes e1MiB+1 rejeitam sem gravação; `assert.equal(afterChallenge.verification.inbound,false)`. Rotação invalida verificação em voo; verificação concorrente da mesma contaA/B concede ownership a um só. Rodar unit webhook-auth e PG whatsapp-connections; esperado FAIL.
- [x] Verificar remotamente fora da transação e aplicar resultado somente com revisão/acesso atuais. Save nunca ready. Sync atualiza hash/revisão/schema/status; catálogo incompleto não valida itens ausentes. `ready` exige ativos verificados e recebimento autenticado; challenge e inbound são provas distintas. Eventos de template invalidam imediatamente versões rejeitadas.
- [x] Meta autentica HMAC-SHA256 sobre bytes originais/AppSecret antes do JSON, comparação constante; challenge exige modo subscribe e verifyToken próprio. Twilio usa SDK oficial, todos os campos form e URL canônica de `CHANNEL_PUBLIC_BASE_URL`+rota; ignora Host/XForwarded. Stream limitado rejeita tamanho/tipo/parâmetros ambíguos sem aceitar prefixo parcial. Eventos sem telefone ficam no escopo WABA. publicId aleatório apenas localiza.
- [x] Desconexão incrementa revisão e pausa envios; material antigo só autentica recibos de tentativas já existentes. Callback antigo não cria conversa/janela nem reativa. Não revogar conta remota implicitamente. Repetir focais + typecheck; esperado PASS. Commit `feat: verify tenant assets and authenticate provider callbacks`.

### Task 5: Entrada durável, identidades e interrupção

**Files:** criar 023, `src/server/channels/{events,webhooks}.ts`, `src/server/messaging/{repository,consent,inbox}.ts`, `src/app/api/channel-webhooks/meta/[publicId]/route.ts`, `src/app/api/channel-webhooks/twilio/[publicId]/[kind]/route.ts`, `tests/integration/whatsapp-ingress.test.ts`.

**Interfaces:** `ingestAuthenticatedBatch(batch:AuthenticatedBatch):Promise<{stored:number;duplicates:number}>`; `applyReceivedEvents(limit:number):Promise<number>`; `listConversations(p:Principal,query:{search?:string;cursor?:string;senderId?:string}):Promise<{items:ConversationView[];nextCursor:string|null}>`; `readConversation(p:Principal,id:string,cursor?:string):Promise<{conversation:ConversationView;messages:MessageView[];nextCursor:string|null}>`; `recordConsent(p:Principal,input:unknown):Promise<void>`; `suppressIdentity(p:Principal,input:unknown):Promise<void>`. Barreira de resposta/supressão é persistida aqui; cancelamento de inscrições será conectado emT6.

- [x] RED PG: batch repetido→1 mensagem/unread; `assert.equal(afterOldStatus.deliveredAt,before.deliveredAt)`; failure preserva read. Mídia sem texto e BSUID sem telefone entram sem lead; portfolios não se cruzam. Redelivery antigo não reabre janela; timestamp futuro não autoriza. FalhaDB→5xx, assinatura inválida→4xx, 2xx somente após COMMIT. Rodar `rtk npm run test:integration -- whatsapp-ingress`; esperado FAIL.
- [x]023: contact_identity, conversation, channel_message, channel_received_event, consent_evidence, contact_suppression, status_evidence e leituras por usuário. Identity única workspace+scope+externalId; message única conexão+direção+remoteId; dedup distingue status reais. FKlead nullable/composta. Conteúdo recebido em message, ingest guarda hash/normalizado necessário sem duplicar corpo bruto; consultas paginadas/cursor estável.
- [x] Persistir evento e barreira de resposta/supressão antes do 2xx, na mesma transação; processamento posterior de histórico não atrasa bloqueio de envio. Scope vem do adapter autenticado. App não fabrica evento autenticado; ingress tem apenas funções de conexão, sem leitura da inbox inteira.
- [x] Opt-out usa comparação determinística de stopKeywords e supressão explícita, sem IA; stopOnReply é separado. Consentimento registra finalidade/origem/instante/autor/evidência; inbound permite atendimento, não campanha irrestrita. Associação a lead exige vínculo verificável. Repetir PG + webhook-auth/typecheck; esperado PASS. Commit `feat: persist authenticated WhatsApp conversations and consent`.

### Task 6: Publicação imutável e inscrições revisadas

**Files:** criar 024, `src/server/messaging/{publication,outbox}.ts`, `tests/integration/cadence-publication.test.ts`; modificar `src/server/channels/events.ts`, `src/server/workspaces/{schemas,commands}.ts` somente onde necessário para revisão de rascunho e cancelamento, preservando saveDraft04.

**Interfaces:** `preparePublication(p:Principal,input:unknown):Promise<PublicationReview>`; `confirmPublication(p:Principal,input:unknown):Promise<PublicationView>`; `pausePublication(p:Principal,input:unknown):Promise<PublicationView>`; `materializeDueMessages(now:string,limit:number):Promise<number>`; `stopPendingForIdentity(c:Db,identityId:string,reason:'reply'|'optout'):Promise<void>`. Confirm recebe PublicationInput+requestId+reviewToken; pause recebe publicationId/expectedRevision/requestId. Prova congela objetos elegíveis/autor/revisõesT2/04, token10min existente.

- [x] RED PG: `assert.equal(outboxAfterPrepare.length,0)`; operator/revisão expirada403/409; editar draft não muda publicação; replay retorna mesmos IDs. Mudança de destinatário/contexto/rota/credencial/template invalida. EMAIL/LinkedIn indisponível bloqueia, não pula. Downtime materializa só etapa atual e espera aceitação antes da seguinte. Rodar `rtk npm run test:integration -- cadence-publication`; esperado FAIL.
- [x]024 cria cadence_publication append-only, cadence_enrollment com etapa/âncora/horário, message_outbox com revisão/intenção/conversa/purpose, dispatch_attempt e message_usage_ledger. Ledger próprio não exige job/lead fictício nem mistura quota IA. Unicidades workspace+request, publication+lead e enrollment+step. Aceitação, entrega e custo nullable são distintos.
- [x] Preparação read-only; confirmação usa locks workspace→conexão/remetente→publicação→inscrição→outbox e recalcula prova/autoridade. Sender explícito, dados estrangeiros403/404. Mostrar destinatários bloqueados. Validar componentes/variáveis correspondentes ao conteúdo aprovado; corpo IA inteiro como variável não substitui template aprovado.
- [x] Conectar cancelamento à barreiraT5, incluindo etapas de outros canais quando stopOnReply; preservar in-flight. AgendaT1 bloqueia feriado sem calendário. Novos leads exigem nova revisão nesta entrega; status legado não é autorização. Repetir foco + planning-confirmation/commands/typecheck; esperado PASS. Commit `feat: publish reviewed cadence snapshots and scoped enrollments`.

### Task 7: APIs de configuração, publicação e inbox

**Files:** criar `src/server/channels/http.ts`, `src/server/messaging/{replies,http}.ts`, `src/app/api/channels/route.ts`, `src/app/api/channels/[id]/[action]/route.ts`, `src/app/api/messaging/[resource]/route.ts`, `src/app/api/messaging/[resource]/[id]/[action]/route.ts`, `tests/integration/whatsapp-http.test.ts`.

**Interfaces:** handlers `(request:Request,params:Record<string,string>):Promise<Response>` com allowlists fechadas; route.ts resolve params Promise antes de chamar handler. `/api/channels`: GETlist/POSTsave; actions verify/sync-templates/disconnect/limits/test-prepare/test-confirm. `/api/messaging`: GETconversations/templates/publications; POSTconsents/suppressions/publication-prepare/publication-confirm. conversations/:id: GETmessages, POSTread/link-lead/reply-prepare/reply-confirm; publications/:id: POSTpause. `prepareReply(p:Principal,conversationId:string,input:unknown):Promise<Review<PreparedSend>>`; `confirmReply(p:Principal,conversationId:string,input:unknown):Promise<MessageView>`. Teste usa prepare/confirm com purpose=test, destino explícito e permissão administrativa.

Também exportar `prepareChannelTest(p:Principal,connectionId:string,input:unknown):Promise<Review<PreparedSend>>` e `confirmChannelTest(p:Principal,connectionId:string,input:unknown):Promise<MessageView>`; destinatário de teste E.164 cria identidade/conversa apenas na confirmação, sem lead fictício. Gestão inclui POSTverify-token com `readVerifyToken(p:Principal,id:string):Promise<{verifyToken:string}>` e `saveSenderLimits(p:Principal,input:unknown):Promise<void>`. Inbox exporta `markConversationRead(p:Principal,id:string):Promise<void>` e `linkConversationLead(p:Principal,id:string,input:unknown):Promise<ConversationView>`; read usa último messageId visto para não apagar unread de chegada concorrente. `listPublications(p:Principal):Promise<PublicationView[]>` pertence a publication.ts; templates consultam catálogo persistido, não fazem sync implícito por GET.

- [x] RED HTTP: sessão/origem/workspace divergentes, ID estrangeiro e papel indevido não alteram dados. `assert.equal(replyReplay.id,firstReply.id)`; conteúdo mudado/review vencido/requestId com outra carga409; read/verify/sync geram zero envios. Rodar `rtk npm run test:integration -- whatsapp-http`; esperado FAIL.
- [x] Implementar schemas fechados, body limitado, no-store/checkOrigin e papel SQL atual. Manual reply resolve variáveis na prévia e usa outboxT6, sem POST direto. Teste não contorna opt-in/janela/template/teto. Vínculo ao lead revisado por admin com FK do tenant; não merge automático. Paginação≤100/requisição; templates filtram conexão pertencente ao tenant.
- [x] API não exporta config/segredos. Falta callback canônico vira bloqueio, não URL inferida de headers. Actions de gestão incluem get de verifyToken restrito a admin; leitura padrão só hasSecrets. Repetir PG + typecheck; esperado PASS. Commit `feat: expose reviewed channel and inbox APIs`.

### Task 8: Worker, quotas e recuperação

**Files:** criar 027, `src/server/messaging/{worker-db,lease,dispatch,receipts,usage,reconciliation}.ts`, `tests/integration/{whatsapp-dispatch,whatsapp-recovery}.test.ts`; modificar outboxT6/eventsT5 apenas para integrar recibos/cancelamento.

**Interfaces:** `claimDispatch(now:string):Promise<DispatchLease|null>`; `heartbeatDispatch(lease:DispatchLease):Promise<DispatchLease>`; `dispatchOne(lease:DispatchLease,deps:{adapter:ProviderAdapter;now:()=>string}):Promise<void>`; `recordDispatchReceipt(lease:DispatchLease,receipt:Receipt):Promise<void>`. `ReconciliationSnapshot={messageId:string;attemptId:string;remoteId:string|null;resolution:'accepted'|'not_accepted';evidence:string}`; `prepareReconciliation(p:Principal,messageId:string,input:unknown):Promise<Review<ReconciliationSnapshot>>`; `confirmReconciliation(p:Principal,input:unknown):Promise<MessageView>`. Expô-las por actions administrativas reconciliation-prepare/reconciliation-confirm da API messages/:id; sem botão retry irrestrito.

- [x] RED PG: duas cadências+manual com quota 1→`assert.equal(posts,1)`; resposta/supressão/rotação/revogação antes da barreira→zero POST. Lease vencido não envia. Aceite+crash antes do receipt→uncertain; restart não duplica. Callback antes do REST consome uma vez. Timeout não retry; rejeição transitória comprovada tem≤3 tentativas, backoff≥30000ms/RetryAfter; auth401 não retry. Rodar `rtk npm run test:integration -- whatsapp-dispatch whatsapp-recovery`; esperado FAIL.
- [x]027 define funções SECURITYDEFINER/search_path fixo/sem EXECUTE PUBLIC; dispatcher somente claim/heartbeat/credentiallease/intent/receipt. Receipt após revogação só finaliza tentativa existente e consumo, não cria nova etapa. Expirar lease depois de marcador de POST não volta automaticamente a pending; materialização também exige autoridade atual.
- [x] Reservar quota atomicamente por workspace+sender/dia no fuso configurado; accepted/uncertain/reservas contam e todos os envios compartilham teto. Espaçamento whatsappIntervalSeconds é por remetente: sortear dentro da faixa confirmada, persistir nextEligibleAt e não sortear de novo para antecipar. Custo desconhecido=null; falha de entrega não reembolsa quota automaticamente. Credenciais somente após lease/autoridade válidos.
- [x] Barreira imediatamente antes do POST: lockT6, revisar autoridade/snapshot/consentimento/resposta/supressão/revisões/24h/template/agenda/tetos, gravar intenção+attempt dispatching+reserva e COMMIT. Fazer uma chamada fora da transação. Resposta do contato posterior à barreira vê in-flight; não prometer cancelamento remoto. Recibo REST/callback permanece idempotente mesmo após mudança de papel/configuração. Aceitação não equivale a delivered.
- [x] Próxima etapa apenas após aceitação persistida, por T1; uncertain bloqueia. Retry comprovado revalida todas as regras. Reconciliation consulta ID conhecido quando suportado; sem ID exige evidência administrativa verificável e revisão. Prova de não aceite libera só reserva correspondente; novo envio exige nova confirmação. Nunca trocar provedor. Repetir focais + typecheck; esperado PASS. Commit `feat: dispatch fenced WhatsApp messages with aggregate limits and recovery`.

### Task 9: Conexão guiada nas configurações

**Files:** criar `src/client/channel-client.ts`, telas settings do mapa, `tests/channel-client.test.ts`; modificar `src/modules/settings/channels.tsx`, `src/app/(app)/settings/[[...section]]/page.tsx` e estilos necessários.

**Interfaces:** `createChannelClient(options:WorkspaceTransportOptions)` retorna list/save/verify/syncTemplates/disconnect/setLimits/prepareTest/confirmTest/getVerifyToken/dispose, usando DTOsT1 e payloadsT2/T7. Reutilizar transporte existente; IDs estáveis por confirmação e dispose aborta operações.

- [x] RED: troca de workspace/desmontagem descarta resultado antigo; doubleclick mantém requestId; blank preserva segredo; `assert.equal(confirmTestCallsAfterVerify,0)`. Rodar `rtk proxy node --experimental-strip-types --test tests/channel-client.test.ts`; esperado FAIL.
- [x] Implementar cards Meta/Twilio, formulário por provedor, salvar→verificar→callback→templates→teste revisado. Tokens write-only, sem browserstorage/log/query; limpar após sucesso. VerifyToken somente por ação administrativa explícita; readback padrão segue sem segredo. Estado vazio é real; demonstração fica identificada e separada.
- [x] Assistente Meta explica app/permissões/número de teste/WABA/PhoneNumber/callback/assinatura explícita; Twilio distingue APIKey/AuthToken/sender habilitado. Sem QR ou mudança remota silenciosa. Exibir estado, blockers, challenge/inbound, validade conhecida e teto. Operator vê estado operacional sem gestão.
- [x] Repetir foco/typecheck/build; conferir teclado/labels/erros/estados vazios por browser autorizado quando disponível. Se controle local continuar desabilitado, registrar limitação visual, sem alegar inspeção. Commit `feat: add guided tenant WhatsApp connection settings`.

### Task 10: Revisão de cadência e inbox real

**Files:** criar `src/client/{messaging-client,messaging-flow}.ts`, componentes cadence/inbox do mapa, `tests/messaging-flow.test.ts`; modificar `src/modules/cadences/{cadence-editor,cadence-settings,step-editor}.tsx`, `src/modules/messages/inbox.tsx`, páginas `src/app/(app)/{inbox,messages/whatsapp}/page.tsx`.

**Interfaces:** `createMessagingClient(options:WorkspaceTransportOptions)` retorna listConversations/readConversation/markRead/linkLead/recordConsent/suppressIdentity/preparePublication/confirmPublication/pausePublication/prepareReply/confirmReply/prepareReconciliation/confirmReconciliation/dispose; parâmetros/DTOsT1/T5–T8. Flow guarda editing/reviewing/confirming/sent/blocked e só aceita review do snapshot atual.

- [x] RED: texto/sender/template mudado invalida prévia; resultadoA não entra em B; unread/read não envia; `assert.equal(publicationsAfterAiGeneration.length,0)`; uncertain não oferece retry cego. Rodar `rtk proxy node --experimental-strip-types --test tests/messaging-flow.test.ts`; esperado FAIL.
- [x] UI seleciona remetente/template por etapa, resolve variáveis, mostra bloqueios por destinatário/etapa e confirmação de publicação. Versão publicada separada do draft; pause explícito. Feriados sem calendário desabilitados; canais não implementados bloqueados. Lista elegível não cria consentimento.
- [x] Inbox com lista/busca/paginação/unread/thread/identidade opaca/lead opcional/mídia identificada. Responder→prévia→confirmar→outbox; mostrar cancelamento e in-flight. Admin reconcilia com prova/revisão. Remover draft global de sessionStorage, usar memória por workspace/conversa e limpar na troca de sessão/workspace. Sugestões04 permanecem revisáveis; sem autoresposta IA.
- [x] Repetir foco/typecheck/build e revisão visual autorizada. Commit `feat: operate published cadences and tenant WhatsApp inbox`.

### Task 11: Processos, retenção e aceite controlado

**Files:** criar scripts worker/maintenance/smoke do mapa, `tests/integration/whatsapp-lifecycle.test.ts`, `docs/operations/WHATSAPP-SETUP.md`, `docs/validation/2026-10-21-whatsapp-05a.md`; modificar package.json, `.env.example` se existente, README.md, `scripts/smoke-routes.mjs` (artefato05A separado).

**Interfaces:** `runMessagingTick(deps:{now:()=>string;maxMessages:number}):Promise<{events:number;materialized:number;dispatched:number}>` no worker; `pruneIngestMetadata(now:string):Promise<number>` emevents. Scripts carregam ambiente servidor e fecham pools no shutdown. Novos scripts npm messaging:worker/messaging:maintenance; processos04/prospecção permanecem separados, sem cron automático.

- [x] RED PG: restart recupera sem repetirPOST, indisponibilidadeDB não expõe logs sensíveis; `assert.equal(messagesAfterPrune,messagesBeforePrune)`; metadata90 dias expira preservando recibos/dedup necessários contra replay. Lifecycle A/B cobre contas próprias, catálogo, publicação, entrada e cancelamento sem rede real. Rodar `rtk npm run test:integration -- whatsapp-lifecycle`; esperado FAIL.
- [x] Implementar tick limitado, `--once`/limite finito e manutenção90 dias. Docs cobrem papéis/chaves/rotação/restore, callbacks, setup BYO Meta/Twilio, limites e uncertain. Falha da versão Meta candidata é explícita, sem fallback.
- [x] Smoke externo desabilitado por padrão; exige workspace/conexão real pronta, destinatário allowlisted, conteúdo revisado, requestId, teto1 mensagem e confirmação, usando API/outbox sem extrair token. Não envia/ativa no startup. Preparar exposição HTTPS com destino/escopo concretos para revisão antes de abrir serviço; falta de app/API/HTTPS/destinatário fica dependência explícita.
- [x] Rodar foco e `rtk npm test`, `rtk npm run test:integration`, `rtk npm run typecheck`, `rtk npm run build`; esperado exit0. Smoke de rotas local autenticado não faz chamadas pagas. Registrar contagens e estados separados: validado offline, Meta externo pendente/validado e Twilio externo pendente/validado. Não declarar marco05 integral concluído.
- [x] Revisão final spec→evidências, secrets/logs/migrações/fixtures/regressões03B/04. Com app/API, HTTPS e confirmação disponíveis, executar1 envio Meta ao contato autorizado, receber resposta e comprovar follow-up bloqueado. Se ausentes, concluir código offline sem afirmar aceite externo. Commit `feat: document and validate WhatsApp operations and controlled acceptance`.

## Cobertura e entrega

| Seção do desenho | Tarefas |
| --- | --- |
| 1–3 recorte/onboarding/contas próprias | T2–T4, T7, T9, T11 |
| 4 propriedade/cifra/permissões | T2, T4, T7–T8 |
| 5 adaptadores | T3–T4 |
| 6 webhooks/retenção/escopo | T4–T5, T11 |
| 7 consentimento/24h/templates | T1, T3–T8, T10 |
| 8 publicação/agenda/quotas/recuperação | T1, T6, T8, T10–T11 |
| 9 inbox/identidade/interrupção | T5, T7–T8, T10 |
| 10 modelo/rotas/contratos | T1–T8 |
| 11–12 aceite e dependências | T9–T11 |

Revisão inline: cobertura mapeada, cinco focos com testes nas tarefas indicadas e contratos de publicação/dispatch separados da prospecção. Revisões durante execução devem preservar o desenho aprovado e ser registradas aqui. O aceite externo depende de configuração e confirmação próprias.

Após revisão deste plano pelo usuário, executar nativamente como já escolhido. Não iniciar código, instalar SDK, migrar banco ou enviar mensagem antes dessa revisão.

## Execução local concluída

Tarefas1–11 implementadas e validadas. Revisão independente: três correções importantes reproduzidas RED→GREEN em uma passagem, nenhuma menor pendente. Ver [validação05A](../../validation/2026-10-21-whatsapp-05a.md) para159 testes de unidade/contrato,129 de integração,59 rotasHTTP, decisões e limitações. Aceite real Meta/Twilio e QA visual continuam pendentes; nenhuma conta ou exposiçãoHTTPS foi criada.
