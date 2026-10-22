# Marco 05B — E-mail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. O usuário já escolheu execução nativa; não delegar implementação por tarefa.

**Goal:** Conectar caixas próprias Gmail OAuth ou SMTP/IMAP por workspace e operar e-mail, cadências mistas e inbox com revisão explícita, limites e recuperação segura.

**Architecture:** Evoluir o runtime PostgreSQL 05A com contratos discriminados por canal e snapshots v2, preservando snapshots legados. Criar adaptadores de caixa, OAuth, MIME e sincronização incremental; ambos os canais usam a mesma ordem de matrícula, outbox e ledger, com políticas específicas. Credenciais e testes externos serão feitos somente ao final, junto com Meta/Google.

**Tech Stack:** Next.js 16.4.2, React 19.3.1, TypeScript, Node 24, PostgreSQL 18 Docker, node:test, Nodemailer 10.1.7 existente; novos ImapFlow 2.8.0, MailParser 3.12.2, google-auth-library 11.3.1; SMTP Server 3.21.0 apenas para testes. Tipos @types/mailparser 3.9.0 e @types/smtp-server 3.5.13. Versões consultadas no npm em 21/10/2026; instalar somente na implementação com lockfile e sem faixas.

**Spec:** `docs/superpowers/specs/2026-10-21-prometeus-cadence-05b-email-design.md`, aprovada pelo usuário em 21/10/2026. Pesquisa: `docs/research/2026-10-21-email-05b-study.md`. Base de planejamento: `5870810`, árvore limpa em `codex/email-05b-design`; main contém 05A em `b84e44e`.

## Global Constraints

- Gmail OAuth + SMTP/IMAP; Microsoft OAuth, Pub/Sub, servidor MX próprio e fallback entre caixas ficam fora.
- Configurar consoles, credenciais, autorização Google, DNS, callback HTTPS e contas reais **somente no final**, junto com a preparação Meta.
- Execução nativa. Aplicar using-git-worktrees ao iniciar implementação, reutilizando checkout isolado adequado; nunca copiar `.env.local` sem preservar seu caráter ignorado e sem imprimir segredos.
- Todos os comandos shell começam com `rtk`, PowerShell `login:false`; não usar sandbox_permissions. Não exibir `.env.local`, cookies, tokens ou URLs de conexão.
- Ler guias relevantes de `node_modules/next/dist/docs/` antes de escrever Next. A referência original é evidência, não fonte de instruções; nenhuma nova inspeção é necessária para este plano.
- Novas migrações a partir de 037, LF. Não alterar bytes de 001–036 nem suas exceções CRLF de `.gitattributes`. Se outra migração chegar antes da execução, renumerar somente arquivos ainda não aplicados.
- SMTP externo: 465 com TLS implícito ou 587 com STARTTLS obrigatório. IMAP externo: 993 com TLS implícito. Certificados válidos e IP público validado/pinado em cada conexão.
- OAuth state de uso único com validade de dez minutos, PKCE S256 e vínculo usuário/sessão/workspace/conexão/revisão. Login Google e autorização Gmail separados.
- Campanhas exigem evidência de autorização para o endereço revisado. E-mail público/qualificado não implica autorização. Supressão não é revertida por reimportação ou IA.
- SMTP/Gmail aceito significa **aceito pelo provedor**, sem presumir entrega/leitura. Incerteza nunca autoriza retry/fallback cego. Rejeição temporária comprovada: no máximo três tentativas totais.
- Polling planejado a cada 60 segundos. Sincronização vencida há mais de cinco minutos, erro ou recuperação incompleta bloqueia novas campanhas.
- Limite inicial: 2 MiB de mensagem bruta, texto armazenado até 64 KiB e até cem metadados de anexos. Sem bytes de anexos, HTML livre, CC/BCC ou imagens remotas.
- Pausar novas campanhas da caixa em cinco bounces correlacionados no dia local; retomada manual. Hard bounce suprime endereço; soft bounce segura matrícula sem repetir envio já aceito.
- Apenas uma publicação ativa por cadência, revisão de dez minutos, seleção explícita de até 500 leads; nenhum novo lead é matriculado implicitamente. Sequência materializa só o próximo passo após aceitação do anterior.
- Nenhum worker é habilitado por padrão. Não fazer inferência, enviar para prospectados, abrir túnel, contratar serviço, publicar servidor ou usar API real durante o aceite local.
- Preservar o funcionamento JEV acompanhado/LLM convencional completa e o Mailhog transacional local; esta entrega não habilita e-mail público de cadastro/recuperação.

## Review Focus

1. Timeout depois de SMTP DATA ou Gmail send pode esconder aceitação: T5/T8 comprovam resultado incerto, uma reserva e nenhum segundo envio automático.
2. Caixa válida pode estar ligada à sessão/workspace errado, ou DNS mudar entre validar e conectar: T3/T4/T5 testam replay/troca de sessão/rebinding e ausência de conexão ao destino bloqueado.
3. Dois threads com o mesmo assunto, aliases `+` ou Message-ID repetido em contas diferentes não podem compartilhar conversa/consentimento: T1/T6/T9 testam identidade e correlação por caixa e destinatário.
4. Resposta ou descadastro entre materialização e despacho deve parar o próximo passo, inclusive no outro canal: T7/T8/T9/T10 testam corrida na barreira SQL e preservam um envio já em voo.
5. Cursor expirado, UIDVALIDITY trocado ou MIME grande não podem parecer ausência de resposta: T3/T6/T8 testam recuperação visível, checkpoint durável e bloqueio de campanhas enquanto há lacuna.

## Mapa de unidades e contratos

`src/domain/mail.ts`: DTOs seguros e conteúdo; `src/domain/mail-policy.ts`: regras puras. `src/domain/messaging.ts`: união de provedores/conteúdos/identidades. `whatsapp.ts` preserva nomes/exports legados e suas regras. `cadence-runtime.ts` discrimina snapshot legado e v2; consumidores não podem acessar `snapshot.sender` sem narrowing.

`src/server/mail/`: `schemas.ts`, `repository.ts`, `connections.ts`, `credentials.ts`, `oauth.ts`, `network.ts`, `mime.ts`, `threading.ts`, `providers/{contracts,gmail,smtp-imap}.ts`, `sync/{repository,gmail,imap,service}.ts`, `ingestion.ts`, `classification.ts`, `unsubscribe.ts`, `diagnostics.ts`, `http.ts`. Cada arquivo responde por uma fronteira; separar orchestration de parsing e persistência.

`src/server/messaging/`: manter lease/receipts/schedule comuns; acrescentar `publication-v2.ts`, `publication-legacy.ts`, `email-dispatch.ts`, `email-replies.ts`, `email-reconciliation.ts`. `publication.ts` vira fachada que seleciona contrato, sem refatorar unrelated prospecting.

`src/client/mail-client.ts` e `mail-copy.ts`: transporte e mensagens de erro; `workspace-provider.tsx` controla ciclo de vida. `src/modules/settings/email-{settings,connection-form,diagnostics}.tsx`, `src/modules/cadences/{email-step-binding,cadence-publication-v2}.tsx`, `src/modules/messages/{email-inbox,email-reply,email-thread}.tsx` estendem os componentes/tokens existentes.

Tipos produzidos por T1:

```ts
type MailProvider = 'gmail' | 'smtp-imap';
type MailContent = {kind:'email';subject:string;text:string;signature:string};
type MailIdentity = {channel:'EMAIL';scope:'email';address:string};
type MailboxState = 'pending'|'authorization_required'|'verifying'|'ready'|'attention'|'disconnected';
type MailboxView = {id:string;senderId:string|null;provider:MailProvider;name:string;address:string|null;revision:number;state:MailboxState;hasSecrets:boolean;sendVerified:boolean;readVerified:boolean;lastSyncedAt:string|null;syncState:'baseline'|'ready'|'recovering'|'error';dailyLimit:number|null;signature:string;lastError:string|null};
type MailMessage = {remoteId:string;remoteThreadId:string|null;rfcMessageId:string|null;inReplyTo:string|null;references:string[];from:string;to:string[];subject:string;text:string;receivedAt:string;direction:'inbound'|'outbound';classification:'human'|'automatic'|'dsn'|'ambiguous';attachments:{name:string|null;type:string;size:number|null}[];truncated:boolean};
type SyncCursor = {kind:'gmail';historyId:string;pageToken:string|null;watermark:string}|{kind:'imap';path:string;uidValidity:string;lastUid:number;watermark:string};
type SyncBatch = {messages:MailMessage[];next:SyncCursor;complete:boolean;gap:boolean};
type MailSend = {connectionId:string;connectionRevision:number;senderId:string;address:string;to:string;content:MailContent;rfcMessageId:string;thread:{remoteThreadId:string|null;inReplyTo:string|null;references:string[]}|null;purpose:'campaign'|'service'|'test';unsubscribeUrl:string|null};
type SyncLease = {workspaceId:string;mailboxId:string;token:string;fence:number;revision:number;expiresAt:string};
```

`MailConfig` contém `mailbox:MailboxView`, configuração pública SMTP/IMAP ou endpoints Gmail fixos, credenciais decifradas e cursores; somente servidor importa esse tipo. `MailDeps` agrega factories de adapter/rede/relógio para testes, nunca opções do body HTTP. Reusar `Principal`, `Review<T>`, `DispatchLease`, `SendOutcome` e `Receipt` já existentes; defini-los em módulo comum ou reexportar sem alterar a semântica.

Contrato v2: `PublicationInputV2={version:2,cadenceId,expectedRevision,leadIds,steps:Record<stepId,{senderId,content}>}`. `PublicationSnapshotV2` congela cadence, facts/context/route/product como o legado, `recipients:[{leadId,steps:Record<stepId,{sender,connectionRevision,identityId,address,content,preview,consentIds,suppressionVersion,replyEpoch,templateProof?}>}]`, limites globais/por canal/remetente e `version:2`. A publicação armazena somente dados revisados, não tokens/senhas. `PreparedSendV2` discrimina `channel:'EMAIL'|'WHATSAPP'`; conteúdo WhatsApp e templateProof mantêm contrato 05A. Matrícula v2 possui associações de identidade por canal/etapa; sua coluna legada `identity_id` pode ser NULL somente para v2, imposta por função de criação e testes.

Cada tarefa abaixo tem ciclo RED → implementação mínima → GREEN → commit próprio. Helpers de fixture são adicionados pela tarefa que os usa em `tests/fixtures/` ou `tests/integration/mail-helpers.ts`; não usar dados pessoais/credenciais reais. Nomes novos de suites devem entrar no allowlist de `scripts/test-integration.mjs` na mesma tarefa. Comandos de integração sempre usam esse runner, nunca conexão direta ao banco principal.

### Task 1: Contratos de canal, identidade e política de e-mail

**Files:** Create `src/domain/{mail,mail-policy,messaging}.ts`, `tests/mail-policy.test.ts`. Modify `src/domain/{whatsapp,cadence-runtime}.ts` e imports de tipos nos clientes/servidores afetados.

**Interfaces:** Produz os tipos acima; `normalizeMailAddress(value:string):string`, `evaluateMailPolicy(input:{purpose:'service'|'campaign'|'test';authorized:boolean;suppressed:boolean;hasInbound:boolean;sendReady:boolean;syncState:MailboxView['syncState'];lastSyncedAt:string|null;now:string}):{allowed:boolean;blockers:string[]}`; `isPublicationV2(snapshot:unknown):snapshot is PublicationSnapshotV2`. `MessagingProvider='meta'|'twilio'|'gmail'|'smtp-imap'`; fábrica WhatsApp rejeita explicitamente provedor desconhecido.

- [ ] **Step 1:** Escrever `mail-policy.test.ts`: `assert.equal(normalizeMailAddress('Sales+one@EXAMPLE.com'),'Sales+one@example.com')`; pontos/aliases e local-parts diferentes permanecem distintos; CR/LF, listas e display-name como endereço falham. Campanha sem autorização bloqueia mesmo com lead qualificado; reply sem inbound bloqueia; sync exatamente com 300 segundos pode passar, acima disso bloqueia; futuro inválido bloqueia; WhatsApp continua tendo sua janela própria.
- [ ] **Step 2:** `rtk node --experimental-strip-types --test tests/mail-policy.test.ts` → FAIL por contrato ausente.
- [ ] **Step 3:** Implementar os contratos, validações de mailbox único (ASCII local-part, domínio IDNA, comprimento total até 254), uniões discriminadas e guard legado/v2; não mudar payload persistido de WhatsApp. Conteúdo de e-mail: assunto 1–200 caracteres, texto 1–64 KiB, assinatura até 4 KiB; MIME total respeita 2 MiB.
- [ ] **Step 4:** Mesmo comando → PASS; `rtk npm run typecheck` e testes WhatsApp de política existentes → PASS.
- [ ] **Step 5:** Commit `feat: define versioned email messaging contracts` com somente arquivos da tarefa.

### Task 2: Armazenamento de caixas, cifra e compatibilidade 05A

**Files:** Create `db/migrations/037-email-mailboxes.sql`, `src/server/mail/{schemas,repository,credentials,connections}.ts`, `tests/integration/{mail-storage.test,mail-helpers}.ts`. Modify `src/server/channels/{crypto,connections,repository}.ts`, `scripts/test-integration.mjs`.

**Interfaces:** `listMailboxes(p:Principal):Promise<MailboxView[]>`, `saveMailbox(p,input:unknown):Promise<MailboxView>`, `disconnectMailbox(p,input:unknown):Promise<MailboxView>`, `readMailConfig(c:PoolClient,id:string,expectedRevision?:number):Promise<MailConfig>`. Saves exigem requestId/revisão; propriedades públicas de SMTP/IMAP passam por strictZod. Operação externa não permanece dentro de transação longa.

- [ ] **Step 1:** Teste `mail-storage`: dois workspaces, papel operador, segredo vazio preservado, rotação/revogação; assert readback não contém token/senha/envelope; assert SQL direto de app/dispatcher não lê credential table; caixa pendente não obtém ownership só por endereço digitado; baseline inexistente impede ready. Fixture legada criada antes da migração mantém snapshot e recibos com hash igual depois.
- [ ] **Step 2:** `rtk npm run test:integration -- mail-storage` → FAIL pela estrutura ausente (registrar suite primeiro).
- [ ] **Step 3:** Migração adiciona canal/provedor email a connection/sender e checks coerentes. Criar `email_mailbox`, `email_oauth_attempt`, `email_sync_cursor`, `email_thread`, `email_message`, `email_address_ownership`, `messaging_channel_limits`, com RLS/FKs compostas/revisões/índices. Remover unicidade universal sender/identity de conversation e recriar índice parcial WhatsApp; email usa thread_key por caixa. Channel_message mantém texto WhatsApp ≤4096; email ≤64 KiB, metadados próprios e sem bytes de anexo. Credential AAD usa união de provedores. Ownership unificado por endereço entre Gmail e SMTP só após prova; caixa não pode estar ativa em outro workspace, inclusive usando outro conector. Endpoints WhatsApp filtram canal e não tratam email como Twilio.
- [ ] **Step 4:** `rtk npm run test:integration -- mail-storage whatsapp-storage whatsapp-connections migrations` → PASS; `rtk npm test` → PASS.
- [ ] **Step 5:** Commit `feat: persist tenant mailboxes and versioned credentials`.

### Task 3: Rede pública pinada e MIME limitado

**Files:** Create `src/server/mail/{network,mime,threading}.ts`, `tests/{mail-network,mail-mime}.test.ts`, `tests/fixtures/mail-messages.ts`. Modify `package.json`, `package-lock.json`.

**Interfaces:** `resolveMailEndpoint(host:string,port:number,protocol:'smtp'|'imap',deps?:NetworkDeps):Promise<{address:string;family:4|6;servername:string;port:number}>`; `composeMail(send:MailSend):Promise<Buffer>`; `parseMail(source:AsyncIterable<Uint8Array>,meta:MailSource):Promise<MailMessage>`; `matchMailThread(message:MailMessage,candidates:ThreadCandidate[]):{kind:'matched';id:string}|{kind:'new'}|{kind:'ambiguous'}`. `MailSource` contém proveniência/IDs remotos e instante de recepção confiável. Limitar headers também na origem, antes de baixar payload completo.

- [ ] **Step 1:** Testes afirmam: DNS público→privado não causa segunda resolução; IP pinado é o usado e SNI original é mantido; IPv6/mapped IPv4 internos bloqueiam; opções de proxy/URL não entram. MIME com script/imagem/instrução maliciosa resulta em texto inerte, nenhum fetch; `assert.equal(parsed.attachments.length,100)` para limite e excesso sinalizado; stream >2 MiB interrompido; referência ambígua não une conversas; cabeçalho injetado é rejeitado.
- [ ] **Step 2:** `rtk node --experimental-strip-types --test tests/mail-network.test.ts tests/mail-mime.test.ts` → FAIL.
- [ ] **Step 3:** Instalar versões fixadas de ImapFlow, MailParser, google-auth-library e tipos; SMTP Server/types somente dev. Usar socket TLS/STARTTLS controlado com IP validado e certificado hostname original (testar integração real da biblioteca, sem segunda resolução implícita). Nodemailer com disableFileAccess/disableUrlAccess, sem logger/debug, um destinatário. MailParser streaming cancela e libera anexos; timer absoluto 30s e limites de bytes/headers/metadados. Message-ID opaco UUID por mensagem com domínio técnico configurado, estável nos retries; remetente/assunto/references validados. Armazenar rfcMessageId sem tomá-lo como autenticação do remetente.
- [ ] **Step 4:** Mesmo comando → PASS; `rtk npm run typecheck` → PASS. Confirmar fixtures não habilitam loopback em configuração de produto.
- [ ] **Step 5:** Commit `feat: bound mail parsing and pin transport destinations`.

### Task 4: Gmail OAuth, renovação e adaptador API

**Files:** Create `src/server/mail/oauth.ts`, `src/server/mail/providers/{contracts,gmail}.ts`, `tests/{mail-oauth,mail-gmail}.test.ts`, `tests/integration/mail-oauth.test.ts`, `tests/fixtures/gmail-api.ts`. Modify `src/server/mail/{connections,credentials}.ts`, `.env.example`.

**Interfaces:** `startGmailAuthorization(p:Principal,sessionId:string,input:unknown,deps?:MailDeps):Promise<{authorizationUrl:string;expiresAt:string}>`; `finishGmailAuthorization(p:Principal,sessionId:string,url:URL,deps?:MailDeps):Promise<MailboxView>`; `withGmailAccess<T>(mailboxId:string,run:(token:string)=>Promise<T>,deps:MailDeps):Promise<T>`. `MailAdapter={verify(config:MailConfig):Promise<{address:string;send:boolean;read:boolean}>;sendOnce(config:MailConfig,send:MailSend):Promise<SendOutcome>;readBatch(config:MailConfig,cursor:SyncCursor|null,budget:{maxMessages:number;maxPages:number}):Promise<SyncBatch>;findSent(config:MailConfig,send:MailSend):Promise<SendOutcome|null>}`. T5 implementa a mesma interface.

- [ ] **Step 1:** Testes de state de dez minutos, replay, logout/troca de sessão, workspace/papel revogado, revision alterada durante troca do código; nenhum token persistido nesses casos. Refresh concorrente realiza uma renovação; resposta sem refreshToken preserva anterior; invalid_grant suspende. API profile fixa endereço; scope incompleto bloqueia. Assert HTTP perdido após send → uncertain e nenhuma segunda chamada; paginação só aceita endpoints Google fixos.
- [ ] **Step 2:** `rtk node --experimental-strip-types --test tests/mail-oauth.test.ts tests/mail-gmail.test.ts` e `rtk npm run test:integration -- mail-oauth` → FAIL.
- [ ] **Step 3:** Cliente OAuth servidor separado com `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI` placeholders, endpoints Google fixos e HTTPS exceto callback loopback local permitido. Consentimento offline e PKCE; scopes mínimos do spec. Validar retorno e vínculo antes e depois da troca; persistência CAS. Estado/verifier cifrados/expiram, state só hash no DB; consumir uma vez antes da troca. Refresh por lease/CAS sem transação de rede longa, invalidar credenciais antigas antes de novos efeitos. Gmail API raw MIME, timeout 30s, JSON limitado a 4 MiB para acomodar base64 de MIME de 2 MiB, redirect error; 403/429 quota comprovados como rejeição com backoff; timeout/5xx de envio conservadoramente uncertain. `findSent` busca por RFC ID e confirma direção/conta/from/to, nunca infere negativo pela ausência.
- [ ] **Step 4:** Mesmos comandos + `rtk npm run typecheck` → PASS; login/auth existente não ganha scopes Gmail nem lê seus tokens.
- [ ] **Step 5:** Commit `feat: connect and refresh workspace Gmail authorization`.

### Task 5: SMTP/IMAP com verificação e semântica de aceitação

**Files:** Create `src/server/mail/providers/smtp-imap.ts`, `tests/mail-smtp-imap.test.ts`, `tests/fixtures/{smtp-server,imap-server}.ts`, `tests/integration/mail-connections.test.ts`. Modify `src/server/mail/connections.ts`.

**Interfaces:** `createSmtpImapAdapter(deps?:MailDeps):MailAdapter`; `verifyMailbox(p:Principal,id:string,expectedRevision:number,deps?:MailDeps):Promise<MailboxView>`. Sender verification e read verification são campos separados; `sendOnce` recebe MIME revisado e não tenta reconectar para repetir efeito.

- [ ] **Step 1:** Fixtures TLS locais via factories de teste: SMTP verify sem MAIL/DATA, IMAP readOnly; senha errada, STARTTLS ausente e certificado incorreto bloqueiam. Final250 gera accepted; 451/550 comprovados geram not_accepted; disconnect depois de DATA gera uncertain. `assert.equal(server.dataCount,1)`; falha APPEND não muda aceitação nem repete DATA. Conexão não reserva From de outra pessoa só porque conseguiu autenticar outro usuário.
- [ ] **Step 2:** `rtk node --conditions=react-server --experimental-strip-types --test tests/mail-smtp-imap.test.ts` e `rtk npm run test:integration -- mail-connections` → FAIL.
- [ ] **Step 3:** Nodemailer sobre transporte pinado T3, auth/timers explícitos; SMTP responseCode e estágio determinam rejeição provada versus incerto. ImapFlow usa EXAMINE/lock, sem CLOSE/expunge/flags/delete. Pasta enviados só leitura para reconciliação, não obrigatória para aceite. Para ligar endereço SMTP a workspace, exigir um teste confirmado dirigido ao próprio endereço com nonce da conexão e observar a mensagem na INBOX verificada; desafio não é enviado por verify. Aqui produzir geração/validação do desafio e estados de verificação, usando recibo e entrada de fixture; integração com outbox/sync será ligada em T6/T8/T10. Ready comercial só após desafio, leitura baseline e limites explícitos. Esse teste de bootstrap usa outbox/ledger em finalidade test e permissão especial limitada à própria caixa; não libera campanhas antes da prova. Não oferecer aliases/From arbitrários após a prova.
- [ ] **Step 4:** Mesmos comandos + `rtk npm run test:integration -- mail-storage mail-oauth` → PASS. Bibliotecas realmente conectam no socket testado, não só mock de opções.
- [ ] **Step 5:** Commit `feat: verify SMTP IMAP mailboxes and send once`.

### Task 6: Sincronização durável, baseline e recuperação de cursores

**Files:** Create `db/migrations/038-email-sync.sql`, `src/server/mail/sync/{repository,gmail,imap,service}.ts`, `src/server/mail/ingestion.ts`, `tests/mail-sync.test.ts`, `tests/integration/mail-sync.test.ts`.

**Interfaces:** `claimMailboxSync(now:string,scope:{workspaceId?:string;mailboxId?:string;limit:number}):Promise<SyncLease[]>`; `runMailboxSync(lease:SyncLease,deps:MailDeps):Promise<{messages:number;complete:boolean;gap:boolean}>`; `ingestMailBatch(lease:SyncLease,batch:SyncBatch):Promise<void>`. SQL claim/heartbeat/commit funções exclusivas ao dispatcher, reads de credenciais apenas com lease e revisão válidos. Ingestão não aceita mailbox/workspace vindos do MIME.

- [ ] **Step 1:** Testes: mailbox com historyId >MAX_SAFE_INTEGER e UIDVALIDITY grande permanece exata; crash na página2 retoma sem duplicar e sem avançar cursor final; 404 history e UIDVALIDITY trocado deixam recovering, campanha bloqueada. Mesmo assunto/Message-ID em outra caixa/workspace permanece isolado. MIME excessivo em mensagem correlacionada cria registro de limitação e hold, nunca cursor ready silencioso. Lote sem mail novo pode atualizar saúde somente após completar sync.
- [ ] **Step 2:** `rtk node --experimental-strip-types --test tests/mail-sync.test.ts` e `rtk npm run test:integration -- mail-sync` → FAIL.
- [ ] **Step 3:** Registrar baseline antes de ready; Gmail historyId e IMAP UIDNEXT observados antes do marco de conexão, com sobreposição para mensagens concorrentes. Gmail filtra entradas INBOX novas; recupera mensagens desde watermark−5min com paginação/dedup. IMAP usa UID e UIDVALIDITY; reset revarre intervalo watermark−5min por INTERNALDATE com dedup. Cursor e lote persistem atomicamente sob lease/fence; 100 mensagens/5 páginas por tick, sem truncar fila; bytes/contagens remotas não são confiáveis. Erro deixa atenção e orçamento/backoff; gap não resolvido exige confirmação administrativa de nova baseline, nunca reset automático oculto. Proveniência e thread remoto + cabeçalhos guiam vínculo; assunto sozinho nunca. Sync de enviados só correlaciona operações conhecidas e respostas nos threads rastreados, sem importar a caixa inteira.
- [ ] **Step 4:** Mesmos comandos + suites mail-oauth/mail-storage → PASS; testar duas execuções concorrentes e sem flags remotas alteradas.
- [ ] **Step 5:** Commit `feat: synchronize mailboxes with durable recovery checkpoints`.

### Task 7: Publicação v2 e sequência mista preservando versões legadas

**Files:** Create `db/migrations/039-multichannel-publications.sql`, `src/server/messaging/{publication-legacy,publication-v2}.ts`, `tests/integration/multichannel-publication.test.ts`. Modify `src/server/messaging/{publication,outbox}.ts`, `src/domain/cadence-runtime.ts`, `src/server/planning/{contracts,prompts}.ts` somente se contrato de assunto precisar ajuste.

**Interfaces:** Fachada `preparePublication(p,input):Promise<Review<PublicationSnapshot>>` / `confirmPublication(p,input):Promise<PublicationView>` discrimina legacy/v2; `publicationV2State(c,p,input:PublicationInputV2)` retorna `{snapshot,proof,blockers}`. Materialização existente mantém assinatura e escolhe contrato. `app.cadence_enrollment_channel` associa enrollment/step/channel/identity/sender/replyEpoch; step index e aceitação comuns à matrícula.

- [ ] **Step 1:** Testes: sequência EMAIL→WHATSAPP→EMAIL congela três remetentes/conteúdos e só materializa predecessor aceito; lead sem telefone publica email-only; sem autorização/template não publica misto. Duplo confirm gera uma versão/matrícula; mudar email/signature/sender/limits/context/route após prepare invalida token. `assert.equal(legacySnapshotHashAfter,legacySnapshotHashBefore)`; rascunho IA não cria publication/outbox. Geração em fixture convencional sem JEV mantém subject/body; JEV sozinho bloqueia.
- [ ] **Step 2:** `rtk npm run test:integration -- multichannel-publication cadence-publication` → FAIL para v2, legado continua GREEN.
- [ ] **Step 3:** Extrair legacy sem mudar comportamento; v2 valida schema estrito, leads ≤500, preview≤2 MiB, evidência por canal/endereço e sender de cada etapa. Criar identity email canônica do workspace com consent/suppression independente de caixa; remetente deve ser verificado. Materialização usa canais associados, texto/signature/subject aprovados e ID RFC imutável; não chama IA. Preservar flag unsupported, calendário, agenda e funções originais como branch para legacy; assinatura/copy v2 somente em novos snapshots. Desvincular identidade obrigatória de matrícula exclusivamente em v2, com invariantes SQL impedindo matrícula sem todas as etapas associadas.
- [ ] **Step 4:** Suites anteriores + planning-confirmation/whatsapp-review-regressions → PASS; zero mensagem de canal ausente ou skip implícito.
- [ ] **Step 5:** Commit `feat: publish reviewed email and mixed channel sequences`.

### Task 8: Despacho e reconciliação de e-mail na outbox comum

**Files:** Create `db/migrations/040-email-dispatch.sql`, `src/server/messaging/{email-dispatch,email-reconciliation}.ts`, `tests/integration/mail-dispatch.test.ts`, `tests/mail-dispatch.test.ts`. Modify `src/server/messaging/{dispatch,guard,receipts,reconciliation,worker,usage}.ts`, `src/server/channels/limits.ts`.

**Interfaces:** `dispatchEmail(lease:DispatchLease,ctx:MailDispatchContext,deps:MailDeps):Promise<void>`; `prepareMailReconciliation(p:Principal,messageId:string,input:unknown,deps?:MailDeps):Promise<Review<ReconciliationSnapshot>>`; confirmação por fachada existente. `MailDispatchContext` contém MailSend, envelope/revisão/guard, saúde sync, autorização/supressão, matrícula/publicação/fatos/limites; saída adapter usa SendOutcome existente. Preservar `claimDispatch`, `recordDispatchReceipt`, `runMessagingTick` e escopo messageId exato.

- [ ] **Step 1:** Corridas de consentimento/supressão/reply/rota/limites/revogação depois do claim e antes do begin SQL impedem envio; sync de301s ou recovering bloqueia campanha. Dois workers/cadências/replies disputam mesma caixa e não excedem teto. Timeout pós-aceite deixa `uncertain`, uma reserva, zero consumo duplicado e `assert.equal(sendCount,1)` após novo tick. Evidência positiva tardia substitui negativo manual; busca vazia não autoriza reenvio. Tentativa3 rejeitada temporariamente não cria quarta.
- [ ] **Step 2:** `rtk node --experimental-strip-types --test tests/mail-dispatch.test.ts` e `rtk npm run test:integration -- mail-dispatch` → FAIL.
- [ ] **Step 3:** Barreira SQL discrimina canal e revalida guard imediatamente antes de durável intenção; email não usa janela/template WhatsApp. Locks de quota em ordem consistente workspace→canal→sender, agregando cadências/testes/replies; manter teto global 05A e acrescentar teto email de workspace, intervalos explícitos e sugestão80/dia não salva automaticamente. Ledger comum reserva/consume/release sem retorno por bounce. Somente rejeição provada permite retry máximo3 com ≥30s, backoff e Retry-After; uncertain para queda depois de intento sem recibo. Mensagem RFC persistida permite findSent posterior; receipt nunca vira send. Worker sincroniza contas elegíveis antes de disparar e continua atendendo canal WhatsApp se email estiver com erro. Falta de sync bloqueia email, não paralisa fila inteira.
- [ ] **Step 4:** Mesmos comandos + whatsapp-dispatch/whatsapp-recovery/whatsapp-reconciliation/whatsapp-review-regressions/multichannel-publication → PASS; scope aplicado antes de LIMIT e teste messageId não toca outros envios.
- [ ] **Step 5:** Commit `feat: dispatch and reconcile email with fenced quotas`.

### Task 9: Respostas, DSNs, supressão e cancelamento cruzado

**Files:** Create `db/migrations/041-email-inbound-stops.sql`, `src/server/mail/classification.ts`, `src/server/messaging/email-replies.ts`, `tests/mail-classification.test.ts`, `tests/integration/mail-inbound.test.ts`. Modify `src/server/mail/ingestion.ts`, `src/server/messaging/{consent,replies}.ts`.

**Interfaces:** `classifyMail(message:MailMessage,headers:Record<string,string>,dsn:DsnFacts|null):{kind:'human'|'automatic'|'hard-bounce'|'soft-bounce'|'ambiguous';correlationId:string|null;stopRequested:boolean}`; `prepareMailReply(p,conversationId,input):Promise<Review<MailSend>&{preview:string}>`; confirmação retorna MessageView estendido por email DTO. `recordEmailConsent(p,input:{requestId;leadId;address;purpose;source;occurredAt;evidence})` valida endereço atual revisado, não aceita futuro e não altera WhatsApp.

- [ ] **Step 1:** Testes: reply com assunto igual mas thread/reference incompatível não cancela pessoa errada; threadID recebido não legitima outro From; endereço ambíguo segura para revisão. DSN multipart/report hard/soft correlacionado por destinatário+operação; DSN forjado sem vínculo não suprime. Cinco bounces distintos pausam caixa; replay não conta duas vezes; troca do dia não retoma pausa manual. Email reply/optout cancela passo WhatsApp futuro da matrícula mista e vice-versa; mensagens em voo não são rotuladas canceladas. Auto-reply identificado não cria outbound autônomo.
- [ ] **Step 2:** `rtk node --experimental-strip-types --test tests/mail-classification.test.ts` e `rtk npm run test:integration -- mail-inbound` → FAIL.
- [ ] **Step 3:** Classificação determinística por MIME/cabeçalhos (incluindo Auto-Submitted/DSN); pedir revisão em dúvida. Guardas de reply valem por enrollment e identidades explicitamente revisadas; atualizar epochs atomicamente, parar somente conforme stopOnReply/step e optout sempre. Hard bounce comprovado suprime email workspace-wide, soft bloqueia matrícula; contar eventos únicos/dia com timezone da caixa e pausa persistente até retomada admin idempotente. Assunto e identidade/correlação precisam ambos ser coerentes para threading de reply manual; uma pessoa com dois threads permanece com dois threads. Sem interpretação/executação de instruções de email por LLM.
- [ ] **Step 4:** Mesmos comandos + mail-dispatch/whatsapp-ingress/multichannel-publication → PASS.
- [ ] **Step 5:** Commit `feat: stop mixed cadences on mail replies and delivery failures`.

### Task 10: APIs, descadastro público e diagnóstico

**Files:** Create `db/migrations/042-email-unsubscribe.sql`, `src/server/mail/{http,unsubscribe,diagnostics}.ts`, `src/app/api/mailboxes/route.ts`, `src/app/api/mailboxes/[id]/[action]/route.ts`, `src/app/api/mail-oauth/google/callback/route.ts`, `src/app/api/mail-unsubscribe/[token]/route.ts`, `src/app/api/mail-unsubscribe/[token]/one-click/route.ts`, `src/app/unsubscribe/[token]/page.tsx`, `src/modules/messages/unsubscribe-form.tsx`, `tests/integration/mail-http.test.ts`. Modify `src/server/messaging/{http,inbox,repository,usage}.ts`.

**Interfaces:** `mailboxHttp(request,params):Promise<Response>`; `gmailCallbackHttp(request):Promise<Response>`; `prepareMailTest(p,id,input):Promise<Review<MailSend>&{preview:string}>`, `confirmMailTest(p,id,input):Promise<MessageView>`; `unsubscribeMail(token:string,mode:'browser'|'one-click',input:unknown):Promise<void>`; `diagnoseMailDomain(p,id):Promise<{spf:'observed'|'missing'|'unverified';dkim:'observed'|'missing'|'unverified';dmarc:'observed'|'missing'|'unverified';alignment:'unverified';notes:string[]}>`. DNS DKIM só consulta selector explicitamente informado; não inventa descoberta/resultado.

- [ ] **Step 1:** Testes HTTP: session/origin/workspace/role/body>2MiB/strict schema, cross-tenant IDs/cursors; callback permite origem Google mas exige state+sessão própria, URL sem token no redirect. GET descadastro não altera DB; POST/browser exige intenção e one-click aceita apenas form esperado, sem sessão; replay idempotente, token inválido não revela email. Duplo confirm de teste/reply/publicação faz uma outbox. DNS só observado não resulta delivered/authenticated. Credenciais nunca em resposta/erro.
- [ ] **Step 2:** `rtk npm run test:integration -- mail-http` → FAIL.
- [ ] **Step 3:** Rotas nodejs/no-store com params await e fachadas finas; reusar channelHttp exceto OAuth callback/descadastro que têm validação específica. GET lista/detalhe/diagnóstico/status; POST save, authorize, verify, sync, disconnect, limits, resume, test-prepare/confirm; caixa e revisão sempre escopadas. Generalizar API de mensagens com canal, direção e caixa nos filtros; payload antigo sem filtro continua WhatsApp para compatibilidade. Tokens descadastro aleatórios256bits/hash; preparar revisão é read-only: token emitido em material de revisão cifrado autenticado vinculado ao send e persistido na confirmação, mantendo URL/conteúdo iguais ao preview. Supressão/stop numa transação; POST sem redirect e rate limit sem invalidar primeiro descadastro legítimo. Link visível e headers RFC8058 só com base públicaHTTPS validada; produção sem base bloqueia campanhas. Fixture usa base controlada e não acessa URL externa.
- [ ] **Step 4:** mail-http + whatsapp-http/auth/tenancy/mail-inbound → PASS; smoke HTTP não executa send. DKIM/alinhamento permanecem não verificados até evidência do piloto.
- [ ] **Step 5:** Commit `feat: expose scoped mail APIs and idempotent unsubscribe`.

### Task 11: Configurações de caixa e revisão de publicação no cliente

**Files:** Create `src/client/{mail-client,mail-copy}.ts`, `src/modules/settings/{email-settings,email-connection-form,email-diagnostics}.tsx`, `src/modules/cadences/{email-step-binding,cadence-publication-v2}.tsx`, `tests/{mail-client,mail-flow}.test.ts`. Modify `src/client/workspace-provider.tsx`, `src/client/messaging-client.ts`, `src/modules/settings/{channels,whatsapp-settings}.tsx`, `src/modules/cadences/{cadence-publication-review,step-editor}.tsx`.

**Interfaces:** `createMailClient(options:WorkspaceTransportOptions)` retorna list/save/startAuthorization/verify/sync/disconnect/limits/resume/diagnose/prepareTest/confirmTest/dispose; preservar ReviewedCommands e identidade de request após resposta perdida. `useMail()` no provider; `EmailSettings()`, `EmailStepBinding({step,content,onChange})`, `CadencePublicationV2({cadence,dirty})`.

- [ ] **Step 1:** Testes de cliente/flow: trocar caixa, assinatura, endereço ou workspace invalida preview; resposta atrasada do workspaceA é descartada emB; doubleclick/timeout preserva requestId; save/verify/sync/AI não chama confirm. Operador só recebe DTOs/ações permitidas; nenhum segredo em draft recovery/localStorage/sessionStorage. Misto exige remetente em cada step; email-only não exige telefone.
- [ ] **Step 2:** `rtk node --experimental-strip-types --test tests/mail-client.test.ts tests/mail-flow.test.ts` → FAIL.
- [ ] **Step 3:** Conectar hook ao ciclo de disposal, formulários write-only e ações separadas; Gmail indisponível sem cliente OAuth explica configuração pendente, sem simular sucesso. SMTP inclui prova da própria caixa como teste revisado; cards mostram verificação de envio/leitura, sync/lag, reconexão, assinatura, limites e bounces. Não expor credencial nos placeholders. Publicação v2 escolhe remetente por step e revisa subject/text/signature/unsubscribe/address de todos os destinatários, até500 e limites2MiB; dirtydraft exige salvar. Histórico legacy exibe leitura e pausa, sem conversão implícita. Limites gerais preservam WhatsApp e acrescentam seção email. Reusar UI/tokens atuais; não restilizar produto.
- [ ] **Step 4:** Mesmo comando + `rtk npm run typecheck` + `rtk npm run build` → PASS; fonte/confirmação/erros por teclado com labels/aria-live e foco do modal. QA visual runtime somente por ferramenta de navegador permitida; se desabilitada registrar pendência sem bypass.
- [ ] **Step 5:** Commit `feat: configure mailboxes and review email cadence steps`.

### Task 12: Inbox de e-mail, threads e respostas revisadas

**Files:** Create `src/modules/messages/{email-inbox,email-thread,email-reply}.tsx`, `src/app/(app)/messages/email/page.tsx`, `tests/mail-inbox-flow.test.ts`. Modify `src/modules/messages/inbox.tsx`, `src/app/(app)/inbox/page.tsx`, `src/components/shell/navigation.ts`, `src/client/messaging-client.ts`, `src/modules/messages/reconciliation-review.tsx`.

**Interfaces:** `listConversations({channel:'EMAIL',senderId?,direction?,search?,cursor?})` e `readConversation` retornam união discriminada com email-thread DTO e cursor; `EmailInbox()`/`EmailReply({conversationId,client,onQueued})`. `/inbox?channel=email|whatsapp` escolhe aba explícita; sem parâmetro mantém WhatsApp por compatibilidade, `/messages/email` abre email e `/messages/whatsapp` continua direto.

- [ ] **Step 1:** Testes de fluxo: mesma pessoa com duas threads não mistura compose/references; seleção rápida A→B não injeta resultadoA; cursor de lidos usa última mensagem exibida, sem marcar remotamente; email externo mostra autoria externa; accepted não exibe delivered/read. Previewreply perdido/retentado mantém um comando. Thread com conteúdo limitado exibe aviso e hold, sem render HTML/remoteimage.
- [ ] **Step 2:** `rtk node --experimental-strip-types --test tests/mail-inbox-flow.test.ts` → FAIL.
- [ ] **Step 3:** Inbox usa filtros caixa/direção/busca, paginação estável e não-lidos por usuário; headers subject/from/to, texto seguro e status reais. Reply só na thread e ao endereço revisado, assinatura prévia, confirmação/outbox; ações admin de consentimento/supressão/reconciliação separadas. Nenhuma IA responde autonomamente. Métricas sem rastreio retornam null/indisponível; estado lido app não é recibo do destinatário. Corrigir navegação E-mail que hoje aponta para `/inbox` WhatsApp.
- [ ] **Step 4:** Mesmo comando + messaging-flow/mail-client/mail-http + typecheck/build → PASS. QA de desktop/mobile/teclado com navegador autorizado se disponível; caso contrário pendência explícita no relatório.
- [ ] **Step 5:** Commit `feat: operate threaded email inbox and reviewed replies`.

### Task 13: Workers locais, documentação conjunta e aceite final

**Files:** Create `scripts/{mail-sync-worker,mail-sync-options,smoke-email}.ts`, `src/server/mail/sync/worker.ts`, `tests/mail-operations.test.ts`, `docs/operations/EMAIL-SETUP.md`, `docs/operations/CHANNELS-PILOT.md`, `docs/validation/2026-10-21-email-05b.md`. Modify `scripts/{messaging-worker,messaging-options,messaging-maintenance}.ts`, `scripts/smoke-routes.mjs`, `src/server/messaging/worker.ts`, `.env.example`, `package.json`, `README.md`, `docs/superpowers/plans/2026-10-20-prometeus-cadence-roadmap.md`. Validation routes artifact `docs/validation/routes-05b.json` gerado só após execução.

**Interfaces:** `runMailSyncTick({now,workspaceId?,mailboxId?,maxMailboxes,maxMessages},deps:MailDeps)` em `src/server/mail/sync/worker.ts` retorna contagens/estados sem conteúdo/segredos; scripts scopes explícitos. Scripts npm `mail:sync`, `mail:smoke`; sync exige `MAIL_SYNC_ENABLED=true` e `--allow-sync`; dispatcher mantém `MESSAGING_WORKER_ENABLED=true` e `--allow-dispatch`. Sincronização pelo dispatcher exige também MAIL_SYNC_ENABLED e flag explícita --allow-sync; sem elas não faz rede de leitura e campanha com sync vencido continua bloqueada. `--once --workspace ID --message ID --max-messages 1` continua exato, sem materializar mensagens alheias; pode sincronizar somente a caixa desse envio para checar respostas.

- [ ] **Step 1:** Teste parser/gates: sem flags/env não há rede/claim; argumentos repetidos/escopo incompatível rejeitados; piloto só envia ID revisado; smoke default skip, prepare read-only e confirm só enfileira uma mensagem. Retry CLI do mesmo preparo não gera novo requestId. Sync tick limita100 mensagens/5páginas por caixa,60s intervalo, até10caixas/tick e um lease por caixa; pendências retomam depois sem declarar ready.
- [ ] **Step 2:** `rtk node --experimental-strip-types --test tests/mail-operations.test.ts` → FAIL.
- [ ] **Step 3:** Implementar scripts/gates/heartbeat/cancelamento, budgets e logs só de IDs/contagens/códigos. Documentar infra separada de creds de workspace, DNS/TLS, callbacks Google-login versus Gmail versus Meta, permissões/Testing/expiração/revisão pública, política de dados, limites/retention e ausência de métricas falsas. Reter histórico de mensagens como WhatsApp; expirar OAuth attempts>10min e metadados técnicos>90dias sem remover dedup/cursors/auditoria. Criar manutenção limitada e teste de pruning. Roteiro final conjunto começa com trabalho manual do usuário somente depois da implementação local: Google Cloud/Gmail/login, MetaBusiness/webhook, SMTP/IMAP se disponível, HTTPS e domínio escolhido pelo usuário; então testes um destinatário próprio/um envio por provedor e resposta/cancelamento, incluindo misto. Não solicitar credenciais no chat.
- [ ] **Step 4:** Executar `rtk npm test`, `rtk npm run test:integration`, `rtk npm run typecheck`, `rtk npm run build`, smoke autenticado de rotas05B, `rtk git diff --check`; todos PASS. Confirmar 05A legado e regressões por sender/tempo fracionário. Rodar comandos default de worker/sync/smoke e confirmar disabled/skipped. Registrar números reais, suites, limitações e ausência de chamadas externas, sem antecipar resultados. Nenhum teste pago ou inferência é necessário.
- [ ] **Step 5:** Commit `docs: validate local email delivery and prepare combined channel pilot`. Aplicar requesting-code-review e uma revisão final independente conforme executing-plans; corrigir achados necessários com regressão, rerodar checks afetados e completos após correções materiais. Aplicar finishing-a-development-branch; autorização prévia para main/push permanece válida se aplicável ao contexto, sem confundir isso com autorização de piloto externo. Não declarar provedor validado antes do teste real.

## Revisão própria e sequência

Sequência T1→T2→T3→T4→T5→T6→T7→T8→T9→T10→T11→T12→T13, execução nativa. Contratos comuns T1 viajam com todas as tarefas; não implementar subprojetos paralelos que mudem essas mesmas tabelas. SQL evolui em 037–042; correções posteriores são migrações novas, nunca edição de arquivo aplicado.

Cobertura: spec§1–4 em T1–5/T11; §5 em T1–2/T6–9; §6 em T3/T7/T11; §7 em T1/T8–10; §8 em T3/T6/T9; §9 em T9–12; §10 em T13 e ciclos de teste das tarefas. Os cinco Review Focus possuem assertions nas tarefas indicadas. Não há requisito dependente de credencial para o aceite local; há requisitos dependentes de conta real explicitamente reservados no roteiro de piloto.

Plano pronto para revisão do usuário. O desenho já está aprovado; a revisão deste plano ainda é necessária antes de instalar dependências ou escrever código de produto. Método preservado: execução nativa nesta conversa.
