# OpenWA gerenciado e QR no Prometeus — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. O usuário já escolheu execução nativa nesta conversa; não redistribuir implementação a subagentes.

**Goal:** Substituir novas conexões e envios Twilio por OpenWA gerenciado, com QR no app, inbox e cadências de texto, mantendo Meta e histórico.

**Architecture:** OpenWA fixado em submódulo e container próprios; Next autentica a empresa e resolve a sessão no backend. Um receiver privado na rede Docker autentica os webhooks e persiste eventos pelo papel de ingresso existente. PostgreSQL do Prometeus continua sendo a autoridade de empresas, revisão, outbox, consentimento e uso; Chromium e autenticação WhatsApp ficam no gateway.

**Tech Stack:** Next 16.4.2, React 19, TypeScript, Node 24, PostgreSQL 18, Docker Compose, OpenWA 0.25.0 na revisão `173916c83b41e622f849ecd380bf36486dfd8cdf`, motor `whatsapp-web.js`. Reusar infraestrutura de testes Node e banco efêmero existentes.

**Spec:** [Desenho aprovado em 23/10/2026](../specs/2026-10-23-prometeus-cadence-openwa-design.md). [Estudo upstream](../../research/2026-10-23-openwa-study.md).

## Global Constraints

- OpenWA gerenciado pelo Prometeus no Docker, com QR Code dentro do app; sem exigir URL/chave de cada cliente.
- Manter Meta oficial. Não converter histórico ou publicações Meta/Twilio para OpenWA silenciosamente.
- Motor inicial `whatsapp-web.js`; `WWEBJS_WEB_VERSION=off`; preservar licença MIT, revisão e lockfile upstream.
- Sem Docker socket, plugins, MCP upstream, gestão de infraestrutura pelo gateway ou exposição pública de sua API/dashboard.
- Teto inicial de 20 mensagens automatizadas/dia por remetente, até 5 novas conversas autorizadas/dia, intervalo de 60–180 segundos. Sem escalada automática. A cota geral compartilhada existente não aumenta.
- Limite de infraestrutura é explícito; a UI não salva acima dele. Esses valores são política inicial do produto, não garantia contra banimento.
- `X-OpenWA-Signature: sha256=<hex>` sobre bytes brutos; segredo por conexão. QR, chaves e arquivos de autenticação nunca entram em logs, evidências ou armazenamento do navegador.
- Apenas conversas individuais de texto; identificar mídia sem implementar anexos, grupos, canais ou importação integral do histórico.
- Resultado incerto não autoriza reenvio com outra chave nem após expirar a retenção de idempotência de 24 horas do gateway.
- Pareamento no telefone e confirmação de testes reais ficam para o final. Desconectar somente a Meta de teste indicada pelo usuário, depois da implementação; preservar sua inbox.
- Gateway/receiver usados por testes de protocolo rodam em projeto Compose `prometeus-cadence-openwa-qa`, env e volumes próprios, gateway de QA em loopback 2786 e banco efêmero `_test`. Nunca apontar callbacks sintéticos ao banco durável de homologação nem reaproveitar uma sessão pareada.
- Não iniciar o próximo marco. Usar `rtk`, processos ocultos no Windows e somente os serviços/volumes deste projeto.
- Ler os guias relevantes em `node_modules/next/dist/docs/` antes de modificar componentes/rotas Next. Não executar scripts do upstream sem verificar o que fazem.

## Review Focus

1. IDs de outra empresa, papel revogado e resposta tardia após trocar de workspace não expõem sessão, QR ou chave (tarefas 3, 4 e 9).
2. Perda de resposta ao criar sessão, chave ou webhook não cria recursos duplicados nem permite parear uma sessão sem proteção (tarefa 4).
3. ACK antes da resposta de envio, evento duplicado/atrasado e timeout não geram segunda transmissão nem regressão de leitura (tarefas 5 e 7).
4. Disputas de limite/novo contato, meia-noite local e janela de atendimento não afrouxam cotas nem aplicam a regra Meta ao provedor errado (tarefas 6 e 8).
5. Reinício, indisponibilidade prolongada e evento antigo depois de logout não reativam sessão, renovam QR indefinidamente ou liberam cadência pausada (tarefas 4 e 10).

## Mapa de arquivos e interfaces

- `third_party/openwa`, `.gitmodules`: fonte upstream fixada, independente do código Prometeus.
- `src/domain/whatsapp.ts`, `src/domain/whatsapp-capabilities.ts`, `src/domain/openwa.ts`: DTOs públicos, capacidades e contratos de sessão.
- `src/server/channels/openwa/{wire,client,repository,provisioning,lifecycle,http,events,maintenance}.ts`: validar protocolo, acessar gateway, persistir operações, administrar sessão e normalizar eventos. Arquivos separados por responsabilidade.
- `src/server/channels/providers/openwa.ts`: adaptação de envio/consulta para `ProviderAdapter`.
- `db/migrations/059-openwa-connections.sql` a `064-twilio-retirement.sql`: alterações aditivas; manter checks legados necessários à leitura e papéis restritos.
- `scripts/channel-ingress.ts`, `scripts/openwa-control.mjs`, `docker/channel-ingress.Dockerfile`, `compose.yaml`: operação do gateway/receiver sem depender de um túnel público.
- `src/modules/settings/openwa-connection.tsx`, `openwa-qr.tsx`: interface de conexão separada do formulário Meta; reusar inbox e editor de cadências existentes.
- `tests/fixtures/openwa/*`, testes unitários e suítes `openwa-*`: fixtures sem dados reais, mock do limite HTTP do gateway e PostgreSQL real efêmero. Registrar novas suítes em `scripts/test-integration.mjs`.

Contratos compartilhados definidos na tarefa 1:

- `Provider = 'meta' | 'openwa' | 'twilio'` para ler legado; `ConnectableProvider = 'meta' | 'openwa'` para criar/conectar. `MessagingProvider` continua incluindo e-mail.
- `OpenwaPhase = 'provisioning' | 'qr_ready' | 'authenticating' | 'ready' | 'disconnected' | 'action_required' | 'failed'`.
- `OpenwaConnectionView = {connection:ConnectionView;phase:OpenwaPhase;phone:string|null;lastCheckedAt:string|null;errorCode:string|null;platformDailyCap:number;platformNewConversationCap:number}`; sem sessão remota ou segredo no DTO.
- `OpenwaQrView = {connectionId:string;revision:number;qrCode:string|null;phase:OpenwaPhase;refreshAfterMs:number}`. QR só existe nessa resposta autenticada sem cache.
- `OpenwaCommand = {requestId:string;expectedRevision:number}`; criação acrescenta `{name:string}`. Nenhum corpo aceita `sessionId`, URL do gateway, chave administrativa ou callback arbitrário.
- `OpenwaMaintenanceResult = {processed:number;failed:number}` e `OpenwaTickOptions = {now:string;maxConnections:number;signal?:AbortSignal}`.
- `WhatsappCapabilities = {connectable:boolean;requiresServiceWindow:boolean;supportsOfficialTemplates:boolean;supportsText:boolean}`. Defaults desconhecidos falham fechados.
- `OpenwaRemoteMessage = {gatewayId:string;remoteId:string;sessionId:string;chatId:string;fromMe:boolean;status:'sent'|'delivered'|'read'|'failed'|'unknown';timestamp:number|null}` normaliza os campos armazenados upstream; `remoteId` vem de `waMessageId`, nunca do UUID de armazenamento.

## Tarefa 1 — Contratos fixados e capacidades por provedor

**Files:** Create `.gitmodules`, `third_party/openwa`, `docs/research/openwa-contracts.md`, `src/domain/openwa.ts`, `src/domain/whatsapp-capabilities.ts`, `src/server/channels/openwa/wire.ts`, `tests/fixtures/openwa/{session,qr,send,inbound,ack,restriction}.json`, `tests/openwa-contracts.test.ts`; Modify `src/domain/whatsapp.ts`, `src/domain/messaging.ts`.

**Interfaces:** Produzir os tipos acima; `whatsappCapabilities(provider:Provider):WhatsappCapabilities`; parsers `parseOpenwaSession(value:unknown)`, `parseOpenwaQr(value:unknown)`, `parseOpenwaSend(value:unknown)` e `parseOpenwaRemoteMessage(value:unknown):OpenwaRemoteMessage` com Zod e limites explícitos. Resposta de envio válida contém `messageId:string` e `timestamp:number` em segundos; sucesso não contém prova de entrega.

- [x] Escrever testes que recusem QR fora do formato PNG/data URL limitado, timestamp inválido e resposta HTTP sem ID; Meta exige janela/template, OpenWA aceita texto com política própria e Twilio não é conectável. Exemplo: `assert.equal(whatsappCapabilities('openwa').requiresServiceWindow,false)`.
- [x] Rodar `rtk proxy node --experimental-strip-types --test tests/openwa-contracts.test.ts`; observar falha por contratos ausentes.
- [x] Adicionar submódulo do repositório solicitado e fixar o SHA aprovado. Ler DTOs e emissão efetiva de eventos upstream, documentar propriedades e IDs usados, incluindo `message.failed` e `session.restriction`; sanitizar fixtures. Implementar parsers e capacidades sem instalar o gateway no processo Next.
- [x] Reexecutar o teste e `rtk npm run typecheck`; contratos passam e projeto compila. Verificar o SHA do gitlink e o aviso MIT.
- [x] Commit: `feat(openwa): pin gateway and define provider contracts`.

## Tarefa 2 — Gateway e receiver privados, reproduzíveis

**Files:** Create `docker/channel-ingress.Dockerfile`, `.dockerignore`, `scripts/channel-ingress.ts`, `scripts/openwa-control.mjs`, `tests/openwa-infrastructure.test.ts`; Modify `compose.yaml`, `scripts/local-env.mjs`, `package.json`.

**Interfaces:** `openwa-control.mjs` expõe `start|status|stop`, limita-se aos serviços `openwa`/`channel-ingress` e não imprime ambiente/chaves. `channel-ingress.ts` cria servidor interno em `0.0.0.0:3214`, `/health` e recusa demais rotas até o handler da tarefa 5. Gateway em `127.0.0.1:2785`; callback canônico interno `http://channel-ingress:3214/api/channel-webhooks/openwa/<publicId>`.

- [x] Escrever teste executável com Compose renderizado em ambiente de teste e servidor HTTP real: volumes próprios, gateway em loopback, receiver sem `ports`, ausência de Docker socket, API sem chave recusada, `/login` e `/api/auth/get-session` no receiver devolvem 404. Assert: `assert.equal(response.status,404)` para rota fora da allowlist.
- [x] Rodar `rtk proxy node --experimental-strip-types --test tests/openwa-infrastructure.test.ts`; falhar por receiver/configuração ausentes.
- [x] Construir imagem upstream fixada; fixar base Node 24/digest verificado para receiver e só copiar fontes/dependências necessárias. Gerar `OPENWA_ADMIN_API_KEY` aleatória no env local e passar como `API_MASTER_KEY` ao gateway, sem ler/logar bootstrap. Definir `ENGINE_TYPE=whatsapp-web.js`, `WWEBJS_WEB_VERSION=off`, `AUTO_START_SESSIONS=true`, `SEND_PACING_ENABLED=true`, schedule constante `20`, cold cap `5`, breaker `5`/`900000ms`; `SSRF_ALLOWED_HOSTS=channel-ingress` e proteção ligada. Não habilitar plugins/MCP/administração Docker.
- [x] Rodar teste e `rtk proxy node scripts/openwa-control.mjs start`; conferir health dos dois serviços e persistência após reinício, sem sessão pareada. Comando só usa este projeto Compose. Logs da validação passam por filtro de segredos.
- [x] Commit: `feat(openwa): provision private gateway infrastructure`.

## Tarefa 3 — Armazenamento de sessão, operação durável e isolamento

**Files:** Create `db/migrations/059-openwa-connections.sql`, `src/server/channels/openwa/repository.ts`, `tests/integration/openwa-helpers.ts`, `tests/integration/openwa-storage.test.ts`; Modify `scripts/test-integration.mjs`, `src/server/channels/repository.ts`, `src/server/channels/ingress-contracts.ts`.

**Interfaces:** `createOpenwaRecord(p:Principal,input:{requestId:string;name:string}):Promise<OpenwaConnectionView>`; `readOpenwaRecord(p:Principal,connectionId:string):Promise<OpenwaConnectionView>`. Operação persistida vincula workspace/conexão/revisão, nome remoto determinístico `pc-<connection UUID>`, UUID remoto único, fase, estado desejado, API-key ID, webhook ID, lease, prazos, tentativas e cursor. Credenciais ficam em `channel_credential`, nunca nessa view.

Contrato SQL da manutenção: `app.claim_openwa_operation(p_now timestamptz)`, `app.read_openwa_operation(p_ws text,p_connection text,p_token text,p_fence bigint)` e `app.finish_openwa_operation(p_ws text,p_connection text,p_token text,p_fence bigint,p_result jsonb)`. Somente o papel dispatcher pode usá-los; read/finish conferem lease, revisão e estado desejado. A implementação TS esconde token/envelope e valida `p_result` por fase, sem UPDATE genérico fornecido pelo navegador.

- [x] Criar integração com duas empresas e papéis distintos: mesmo requestId retorna mesma conexão, corpo diferente dá 409; empresa B não lê nem altera conexão A; operador não provisiona; uma sessão não pode pertencer a dois workspaces. Assert: `assert.equal(otherWorkspaceStatus,404)`.
- [x] Rodar `rtk npm run test:integration -- openwa-storage`; observar falta de migração/repositório.
- [x] Ampliar checks do canal para OpenWA preservando provedores legados/e-mail; criar tabela `app.openwa_connection` com RLS/FORCE RLS, FK composta, unicidade de sessão e associação única por conexão. Criar operações duráveis e funções restritas de claim/read/finish para `cadence_dispatcher`, com lease/fence de 60 segundos e validação de estado/revisão. Nunca liberar SELECT genérico nas credenciais para o receiver/dispatcher.
- [x] Rodar integração e suíte `migrations`: instalação limpa e upgrade de catálogo existente preservam Meta/e-mail e grants. Testar remoção de associação de usuário entre claim e finalização.
- [x] Commit: `feat(openwa): persist tenant-bound session lifecycle`.

## Tarefa 4 — Provisionamento recuperável e API autenticada de conexão

**Files:** Create `src/server/channels/openwa/client.ts`, `provisioning.ts`, `lifecycle.ts`, `http.ts`, `tests/openwa-client.test.ts`, `tests/integration/openwa-connections.test.ts`; Modify `src/server/channels/http.ts`, `src/client/channel-client.ts`, `src/server/channels/provider-errors.ts`.

**Interfaces:** `createOpenwaClient({origin,apiKey,fetchImpl?})` produz `createSession`, `findOwnedSession`, `startSession`, `readSession`, `readQr`, `createScopedKey`, `createWebhook`, `logoutSession`, `revokeScopedKey`, com parsers da tarefa 1. Incluir `readRemoteMessage(sessionId:string,remoteId:string):Promise<OpenwaRemoteMessage|null>` e `readMessages(sessionId:string,{after?:string;limit:number}):Promise<{items:OpenwaRemoteMessage[];nextCursor:string|null}>`, ambos limitados à sessão. Exportar `requestOpenwaConnection(p,input)`, `readOpenwaConnection(p,id)`, `readOpenwaQr(p,id,revision)`, `requestOpenwaReconnect(p,id,command)`, `requestOpenwaDisconnect(p,id,command)` e `runOpenwaMaintenanceTick(options:OpenwaTickOptions,deps?):Promise<OpenwaMaintenanceResult>`.

- [x] Testar HTTP completo: POST `/api/channels/openwa` e POST `/api/channels/:id/openwa-reconnect|openwa-disconnect`; GET `/api/channels/:id/openwa-status|openwa-qr?revision=N` com `no-store`. Trocar workspace, revogar papel e adulterar sessão/URL no corpo devem falhar antes de chamada remota. Exemplo: `assert.equal(qrResponse.headers.get('cache-control'),'no-store')`.
- [x] Rodar `rtk proxy node --experimental-strip-types --test tests/openwa-client.test.ts` e `rtk npm run test:integration -- openwa-connections`; obter falhas esperadas.
- [x] Implementar HTTP server-to-server com origem apenas de configuração, sem redirects e sem incluir segredo em erro. Read deadline 10s; início de engine 45s sob lease renovado. Reservar conexão local antes de I/O e atualizar por fase fora de transação longa. Recuperar criação por nome exato/paginação limitada, sem nova sessão por timeout. Criar chave OPERATOR com `allowedSessions:[sessionId]`, secret HMAC de 32 bytes e webhook da conexão antes de liberar QR; usar admin só no provisionamento. Chave com resposta perdida é revogada/renovada por ID/nome, sem reutilizar segredo desconhecido. Desconexão bloqueia sender imediatamente e enfileira logout/revogação idempotentes; falha remota permanece visível, sem falso desconectado remoto.
- [x] Reexecutar testes com perda da resposta em cada fase, concorrência de duas criações, QR expirado, logout durante start e webhook de revisão anterior. Uma tarefa com estado desejado desconectado não volta a pronta; nenhum número remoto arbitrário é adotado.
- [x] Commit: `feat(openwa): add recoverable managed QR connection API`.

## Tarefa 5 — Webhooks autenticados, inbox e estado da sessão

**Files:** Create `src/server/channels/openwa/events.ts`, `db/migrations/060-openwa-ingress.sql`, `tests/openwa-events.test.ts`, `tests/integration/openwa-ingress.test.ts`; Modify `src/server/channels/webhook-auth.ts`, `webhook-events.ts`, `webhooks.ts`, `ingress-db.ts`, `events.ts`, `scripts/channel-ingress.ts`.

**Interfaces:** `authenticateOpenwaWebhook(request:Request,publicId:string):Promise<AuthenticatedBatch>` e `normalizeOpenwaEvents(body:unknown,ctx:IngressContext):WebhookEvent[]`; ampliar união de evento com `session` para atualizar apenas sessão vinculada. `handleChannelIngress(request:Request):Promise<Response>` aceita apenas POST no caminho OpenWA exato, corpo até 1 MiB e concorrência até 16; health não revela configuração.

- [ ] Escrever testes para HMAC de bytes brutos, JSON alterado, sessão/conta divergente, evento repetido, mídia/grupo/eco, LID sem telefone e `session.status` atrasado. `assert.equal(storedInboundCount,1)` após duplicata. Assinatura inválida e corpo grande não chegam ao SQL; status não cria janela de atendimento.
- [ ] Rodar `rtk proxy node --experimental-strip-types --test tests/openwa-events.test.ts` e `rtk npm run test:integration -- openwa-ingress`; observar falhas.
- [ ] Validar HMAC em tempo constante com envelope atual/versões autorizadas e vínculo exato de sessão. Assinar e confiar em campos do corpo, não headers isolados. Normalizar tempos segundos/ISO separadamente; escopo de identidade `openwa:<connectionId>`, telefone só com correspondência inequívoca. Inscrever também `message.failed`/`session.restriction` para falhas e pausas. Atualizar funções de ingresso com preservação dos caminhos Meta/e-mail, dedup e estados monotônicos; não guardar evento QR/segredos. Estado `ready` exige sessão corrente pronta, número verificado e webhook registrado; não exige mensagem do contato para criar conexão.
- [ ] Rodar suítes `openwa-ingress whatsapp-ingress mail-inbound`. Fazer POST assinado de fixture ao receiver interno Docker e confirmar SQL; não enviar mensagem WhatsApp. Testar ACK que chega antes do recibo HTTP e persistir evidência para associação posterior.
- [ ] Commit: `feat(openwa): ingest signed session and message events`.

## Tarefa 6 — Regras por capacidade e cotas atômicas

**Files:** Create `src/domain/openwa-limits.ts`, `db/migrations/061-openwa-limits.sql`, `tests/openwa-limits.test.ts`, `tests/integration/openwa-limits.test.ts`; Modify `src/domain/whatsapp-policy.ts`, `src/server/channels/limits.ts`, `src/server/messaging/guard.ts`, `replies.ts`, `src/client/whatsapp-copy.ts`.

**Interfaces:** `evaluateSendPolicy` passa a exigir `provider` em `SendPolicyInput`. `openwaLimitPolicy({dailyLimit,newConversationLimit,platformDailyCap,platformNewConversationCap})` valida inteiros e `newConversationLimit<=dailyLimit`. Novos campos no DTO de limites são por remetente, não um limite inferido por nome de conexão.

- [ ] Testar a mesma entrada de texto fora de 24 horas: Meta bloqueia; OpenWA com autorização permite; OpenWA sem autorização bloqueia. Resposta de serviço com entrada real é permitida como hoje. Casos de quota: 20 envios totais, 5 novos contatos únicos, sexto contato bloqueado, resposta em contato existente não gasta quota de novo contato. `assert.equal(policy.allowed,false)` sem consentimento fora da janela de serviço.
- [ ] Rodar `rtk proxy node --experimental-strip-types --test tests/whatsapp-policy.test.ts tests/openwa-limits.test.ts` e `rtk npm run test:integration -- openwa-limits`; observar falhas.
- [ ] Implementar política por capacidade e contagem persistida de novos contatos por remetente/data America/Sao_Paulo, com reserva/consumo/liberação ligados à tentativa. Registrar como novo contato apenas primeiro envio automatizado autorizado sem histórico conhecido; repetir para o mesmo contato no dia não abre nova reserva. Limite compartilhado existente, cotas 20/5 e incerteza mantêm suas reservas; falha de entrega após aceitação não restitui consumo.
- [ ] Rodar testes com duas conexões/claims simultâneas disputando a última vaga, virada de dia, contato suprimido, relógio inválido e edição acima do teto de plataforma; backend e SQL recusam ambos. Dois envios concorrentes ao mesmo novo contato contam uma pessoa, mas a falha de uma tentativa não libera a reserva da outra. Expor motivo localizado sem dizer que o volume evita banimento.
- [ ] Commit: `feat(openwa): enforce provider policies and conservative quotas`.

## Tarefa 7 — Envio, idempotência e reconciliação sem duplicata

**Files:** Create `src/server/channels/providers/openwa.ts`, `db/migrations/062-openwa-dispatch.sql`, `tests/openwa-provider.test.ts`, `tests/integration/openwa-dispatch.test.ts`; Modify `src/server/channels/providers/contracts.ts`, `connections.ts`, `src/server/messaging/dispatch.ts`, `receipts.ts`, `reconciliation.ts`, `guard.ts`.

**Interfaces:** `createOpenwaAdapter(fetchImpl?:typeof fetch):ProviderAdapter`; manter `sendOnce(config,send,callbackUrl?)`, tornando callback opcional no contrato. OpenWA exige `send.traceId` estável, usa-o como `Idempotency-Key` e envia `{chatId,text}` no endpoint fixado. `lookupMessage(config,remoteId)` só reconhece mensagem dessa sessão e identidade compatível; DTO de reconciliação inclui prova de status, sem inventar entrega.

- [ ] Escrever teste que verifique chave/corpo estáveis, `201` como `accepted`, `400` comprovado como `not_accepted`, `409` incerto/in-progress e timeout como `uncertain`. Assert: `assert.equal(outcome.kind,'uncertain')` quando POST perde resposta. Nenhum teste chama o gateway real pareado.
- [ ] Rodar `rtk proxy node --experimental-strip-types --test tests/openwa-provider.test.ts` e `rtk npm run test:integration -- openwa-dispatch`; observar falhas.
- [ ] Implementar envio com limites de resposta e deadline 30s; diferenciar códigos upstream pelos contratos lidos, nunca classificar todo 4xx como não enviado. Usar `messageId` WhatsApp bruto como chave remota, vincular ACK antecipado, preservar reserva em incerteza. Dispatcher não exige `CHANNEL_PUBLIC_BASE_URL` para OpenWA; usa registro privado da sessão/webhook. Guard SQL final repete capacidade, quotas, revisão, vínculo, supressão, autoridade e pausa, inclusive se chamado por fora da camada TS.
- [ ] Rodar suítes `openwa-dispatch whatsapp-dispatch whatsapp-recovery whatsapp-reconciliation mail-dispatch`; testar ACK antes do HTTP, duplicado/depois do reinício, perda após intenção de POST e expiração das 24h de idempotência. Uma única transmissão nos casos incertos; `read` não regride para `accepted`. Com `CHANNEL_PUBLIC_BASE_URL` ausente, OpenWA continua usando o callback privado configurado; erro de configuração continua explícito nos caminhos que exigem origem pública.
- [ ] Commit: `feat(openwa): integrate guarded message dispatch and receipts`.

## Tarefa 8 — Cadência e resposta usando o remetente correto

**Files:** Create `db/migrations/063-openwa-publication.sql`, `tests/integration/openwa-publication.test.ts`; Modify `src/server/messaging/publication-v2.ts`, `publication-legacy.ts`, `replies.ts`, `src/modules/cadences/whatsapp-step-binding.tsx`, `cadence-publication-v2.tsx`, `src/modules/settings/whatsapp-content-field.tsx`, `src/modules/messages/whatsapp-reply.tsx`.

**Interfaces:** Os DTOs de remetente/conexão incluem `capabilities:WhatsappCapabilities`; seleção de conteúdo recebe essas capacidades. `preparePublication` e `prepareReply` existentes congelam provedor/capacidades e mantêm os contratos de revisão atuais.

- [ ] Criar cenário de lista/lead com autorização, texto com variável, conexão OpenWA pronta e agenda: preparar, confirmar, materializar, enviar com mock HTTP, receber resposta assinada e bloquear próximo follow-up. Assert: `assert.equal(remainingEnrollment.state,'stopped')`. Mesmo rascunho em Meta fora de janela exige template aprovado.
- [ ] Rodar `rtk npm run test:integration -- openwa-publication`; observar falha por capacidades/política rígida atuais.
- [ ] Permitir somente texto para OpenWA, incluindo revisão de variáveis resolvidas. Preservar templates/janela Meta, etapas mistas de e-mail, produto/contexto e snapshots. Nova conexão não assume publicações antigas; troca de remetente exige nova revisão. Identidades opacas sem telefone não recebem lead inventado nem são usadas para novo destinatário de campanha.
- [ ] Rodar `openwa-publication multichannel-publication cadence-publication whatsapp-review-regressions`; testar publicação com duas identidades de mesmo telefone em provedores diferentes, opt-out entre revisão e despacho, pausa, mudança de limites e não migração silenciosa de publicações antigas.
- [ ] Commit: `feat(openwa): support reviewed text cadences and inbox replies`.

## Tarefa 9 — Cards Meta/OpenWA e fluxo QR acessível

**Files:** Create `src/modules/settings/openwa-connection.tsx`, `openwa-qr.tsx`, `scripts/qa-openwa-ui.mjs`, `tests/openwa-client-flow.test.ts`; Modify `src/modules/settings/whatsapp-settings.tsx`, `whatsapp-connection-form.tsx`, `src/client/channel-client.ts`, `src/client/whatsapp-copy.ts`, `src/app/settings.css` se necessário.

**Interfaces:** Componentes consomem as ações/DTOs da tarefa 4. Cliente expõe `createOpenwa`, `openwaStatus`, `openwaQr`, `reconnectOpenwa`, `disconnectOpenwa`; cada mutação conserva o requestId em retry, conforme `createReviewedCommands` existente.

- [ ] Escrever fluxo browser com API fixture: cards Meta e número próprio, aviso, abrir QR, expirar, parear, reconectar e desligar. Troca de workspace com fetch pendente não mostra QR antigo. Teste: `assert.equal(await oldWorkspaceQr.count(),0)`. Nunca capturar screenshot de QR/telefone real.
- [ ] Rodar teste do cliente e QA contra versão anterior para registrar a falta do novo fluxo, antes de alterar a tela.
- [ ] Implementar dois cards com ações diretas, modal acessível, QR em memória com `no-store` e sem `localStorage`. Poll de QR a cada 3s somente enquanto modal aberto em fase apropriada, até 10min; demais estados a cada 10s. Sem repetir comando start a cada poll. Exibir erro útil, quota da plataforma e limites 20/5; remover card de Twilio. Aviso explícito de risco e número dedicado; Meta também não promete imunidade a bloqueio.
- [ ] Rodar teste/QA desktop e mobile com fixtures, keyboard/foco/modal, viewport 390px e rascunho preservado após refresh. Testar UI bloqueando valores acima do teto e formulário fechando ao revogar autorização. O script QA recebe `QA_PLAYWRIGHT_MODULE` e `QA_CHROME_PATH` para o tooling já disponível, sem caminhos pessoais fixados no repositório e sem considerar ausência do browser um passe. `rtk npm run typecheck` passa.
- [ ] Commit: `feat(settings): connect own WhatsApp through managed QR`.

## Tarefa 10 — Serviço contínuo de sessão e recuperação limitada

**Files:** Create `src/server/channels/openwa/worker.ts`, `tests/openwa-maintenance.test.ts`, `tests/integration/openwa-recovery.test.ts`; Modify `scripts/runtime-core.ts`, `runtime-supervisor.ts`, `runtime-lane.ts`, `runtime-control.mjs`, `tests/runtime.test.ts`, `docs/operations/CONTINUOUS-RUNTIME.md`.

**Interfaces:** Conectar `runOpenwaMaintenanceTick` da tarefa 4 a lane `channels`. Configurar `RUNTIME_CHANNELS_MS=5000`, até 5 conexões por tick, checagem de sessão pronta a cada 30s, revisões de provedor/ACK pendentes a cada 15s em lotes de 20, backoff limitado de até 5min e máximo de 5 tentativas transitórias por operação de provisionamento antes de ação manual.

- [ ] Testar falha longa, cancelamento, lease expirado, resposta tardia pós-logout e reinício: sem busy loop, QR automático ou envio pela manutenção. Assert: `assert.equal(sendCalls,0)` ao reiniciar/recuperar sessão.
- [ ] Rodar `rtk proxy node --experimental-strip-types --test tests/openwa-maintenance.test.ts tests/runtime.test.ts` e `rtk npm run test:integration -- openwa-recovery`; observar falhas.
- [ ] Adicionar lane oculta com shutdown drenado e metadados sem segredo; gateway mantém reconexão autenticada, worker reconcilia apenas estado conhecido e operações autorizadas. Paginar busca de mensagens pelo cursor com limite, rejeitar gaps silenciosos, e usar mesmo caminho de persistência/dedup dos webhooks para recuperação. Snapshots REST são identificados como `gateway-read`, comprovados pela API de origem fixa com chave limitada à sessão; não fabricar assinatura de webhook. Nunca importar todo histórico nem tratar ausência de mensagem na consulta como prova de não envio. `ready` antigo não supera estado desejado desconectado nem epoch mais novo.
- [ ] Rodar suítes e testar reinício dos containers/processos sem apagar volume. `runtime:status` apresenta cinco lanes vivas; a tarefa Windows continua usando VBS/wscript e não abre console. Confirmar mudança de configuração só entra após reinício explícito e consistente dos processos.
- [ ] Commit: `feat(runtime): maintain OpenWA sessions with bounded recovery`.

## Tarefa 11 — Aposentar Twilio com histórico preservado

**Files:** Create `db/migrations/064-twilio-retirement.sql`, `tests/integration/twilio-retirement.test.ts`; Remove `src/server/channels/providers/twilio.ts`; Modify `src/server/channels/schemas.ts`, `connections.ts`, `webhook-auth.ts`, `events.ts`, `src/app/api/channel-webhooks/twilio/[publicId]/[kind]/route.ts`, `src/modules/settings/whatsapp-connection-form.tsx`, `package.json`, `package-lock.json`, fixtures/testes Twilio existentes.

**Interfaces:** Provedor legado só para leitura. Cadastros/verify/sync/test/publish novos com Twilio retornam código `PROVIDER_RETIRED`; rota de webhook legado retorna 410 sem executar SDK. Dispatcher bloqueia `PROVIDER_RETIRED` antes de I/O. Nenhum histórico recebe provedor OpenWA por atualização em massa.

- [ ] Criar fixture legado diretamente no catálogo de teste em formato anterior à migração; verificar conversa/recibo legíveis, publicação pausada e outbox não transmitida. Assert: `assert.equal(providerCalls,0)` ao tentar criar/verificar/despachar Twilio depois do upgrade.
- [ ] Rodar `rtk npm run test:integration -- twilio-retirement`; falhar enquanto caminhos ativos ainda existem.
- [ ] Pausar publicações e cancelar somente trabalho ainda não transmitido Twilio, preservando tentativa/recibo incerto já existente. Remover importações/SDK e fluxos de tempo REST Twilio; não apagar dados anteriores nem reclassificar resultados. Adaptar testes antigos para provar aposentadoria e manter as verificações compartilhadas Meta/e-mail; revisar diff de remoções.
- [ ] Rodar `rtk npm test`, suítes `twilio-retirement whatsapp-storage whatsapp-http whatsapp-lifecycle mail-http` e `rtk npm run typecheck`. Buscar `twilio` em código para explicar cada ocorrência restante de leitura/migração/410/documentação histórica.
- [ ] Commit: `refactor(whatsapp): retire Twilio while preserving history`.

## Tarefa 12 — Validação final, operação e piloto acompanhado

**Files:** Create `docs/operations/OPENWA-SETUP.md`, `docs/validation/2026-10-23-openwa.md`; Modify `docs/operations/WHATSAPP-SETUP.md`, `README.md`, `docs/superpowers/specs/2026-10-23-prometeus-cadence-openwa-design.md` e este checklist.

**Interfaces:** Nenhuma nova API. Consumir rotas autenticadas de desconexão/pareamento e fluxo revisado de mensagem existentes; produzir evidências saneadas e relatório que distingue código validado de entrega real.

- [ ] Executar `rtk npm test`, `rtk npm run test:integration`, `rtk npm run typecheck`, `rtk npm run build`, QA browser com fixtures e `rtk git diff --check`. Todas as falhas, inclusive preexistentes, devem ser nomeadas; nenhum teste toca produção ou uma sessão WhatsApp pareada.
- [ ] Revisar diff completo e contratos reais: RLS, gateway inacessível publicamente, origem fixa, segredo/QR não logado, retomada sem duplicata e preservação Meta/e-mail. Fazer uma revisão independente final conforme a skill de execução nativa, sem delegar a implementação.
- [ ] Documentar checkout de submódulo, inicialização, memória observada sem pareamento, backup/restore de volume e chaves, atualização fixada e recuperação. Registrar que infraestrutura consome recursos e que não existe garantia contra banimento. Não copiar a promessa de “sem risco” da referência visual.
- [ ] Após build e regressões, subir versão local atualizada, recarregar serviços com a mesma configuração e conferir saúde. Desconectar pelo app somente a Meta de teste previamente indicada, conforme pedido, preservando histórico; não desconectar outras empresas e não remover aplicativos/contas no painel Meta. Apresentar QR ao usuário para leitura manual no telefone escolhido por ele.
- [ ] Usuário confirma um teste revisado com destinatário próprio autorizado; observar uma transmissão, ACK quando disponível, resposta de entrada, atualização de inbox e recuperação de sessão após reinício. Se pareamento/WhatsApp impedir o aceite, registrar o bloqueio externo sem declarar entrega concluída. Nenhuma repetição de resultado incerto nem envio para leads prospectados.
- [ ] Atualizar relatório/checklist com resultado real, integrar na `main` e dar push conforme autorização persistente do usuário; registrar hash. Próximo marco permanece fora do escopo.

## Auto-revisão do plano

- Cobertura: infra/licença (1–2), autorização/persistência (3–4), receiver/inbox (5), limites (6), despacho/ACK (7), cadências (8), UX/QR (9), continuidade (10), Twilio legado (11), regressão/piloto/transição (12).
- Interfaces: DTOs são definidos na tarefa 1 e reusados no cliente/UI; worker consome a manutenção da tarefa 4; receiver consome o handler da tarefa 5. Nenhuma etapa depende de chaves fornecidas pelo usuário final.
- Review Focus: cada um dos cinco riscos tem teste explícito na tarefa proprietária. Falha de telefone/Meta não será confundida com ausência de callback, aceite da API ou entrega real.
- Execução: desenho aprovado; aprovação deste plano pendente. Manter execução nativa já escolhida. Não iniciar a implementação antes da revisão do usuário.
