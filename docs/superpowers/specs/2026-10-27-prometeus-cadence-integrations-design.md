# Integrações, API, agenda e MCP — desenho técnico

**Baseline:**27/10/2026. **Origem:** escopo aprovado e contrato próprio detalhado por solicitação do operador. Implementação pendente nos pacotes abaixo.

**PRD:** [completo](2026-10-27-prometeus-cadence-complete-prd.md). **Arquitetura/segurança/execução:** [contratos compartilhados](2026-10-27-prometeus-cadence-technical-contracts.md).

## Abordagem e reutilização

Adotar evolução dos serviços e telas existentes. Reescrita de backend ou segunda fila foi descartada porque duplicaria autoridade, quotas e efeitos. As escolhas técnicas complementam a aprovação do escopo; não são observações novas sobre o backend do CadenceFlow.

Base inspecionada:

- src/server/workspaces/commands.ts
- src/server/channels/crypto.ts
- src/server/prospecting/extraction/public-url.ts
- src/modules/settings/reference-integrations.tsx
- src/modules/settings/reference-settings.tsx

## Jornada

Conectar conta do cliente → validar capacidades/escopos → mapear → revisar → fila de operação → efeito remoto/reconciliação → histórico/revogação. API/MCP usam os mesmos comandos da UI.

## Regras e limites de responsabilidade

- Separar perfis centraisApify/LLM de contas de Sheets/CRM/Apollo/agenda do cliente. Contratos legados de Apollo central exigem migração explícita, sem expor ou emprestar chaves entreclientes.
- Webhooks são at-least-once comeventid fixo e assinatura; nunca prometer exactly-once do serviço externo. Alteração de destino invalida revisão e revogação interrompe pendências.
- Cada adaptador implementa apenas a superfície contratada, usa schema tipado e idempotency originid. Sem especificação/acesso, exibir bloqueio e registrar decisão de alternativa.
- SSRF, DNSrebind, callbackstate, PKCE e audience são parte do serviço; UI não é perímetro de segurança. MCP não éOAuth de modelos.
- Não reconstruir MeetFlow internamente. A integração oferece os destinos/ações observados e contrato próprio identificado quando não observável.

## Contratos por pacote

### 07C.1 — API, eventos e webhooks de saída

**Requisitos:** R15. **Dependências:** 06E.2, 06C.2.

**Persistência:** api_credential, webhook_destination, integration_outbox, integration_delivery; UNIQUE(workspace_id,destination_id,event_key); token apenas digest, segredo deassinatura criptografado

**DTOs novos:**

```ts
type WebhookInput={name:string,url:string,events:string[],expectedRevision:number};
type WebhookView={id:string,url:string,state:string,secretConfigured:boolean};
type IntegrationEnvelope={id:string,type:string,version:1,occurredAt:string,entity:{kind:string,id:string},data:Record<string,unknown>};
```

**Serviços:**

```ts
declare function prepareWebhook(p:Principal,input:WebhookInput):Promise<Reviewed<WebhookInput>>;
declare function confirmWebhook(p:Principal,input:Confirm<WebhookInput>):Promise<WebhookView>;
declare function dispatchIntegrationTick(input:{limit:number;signal:AbortSignal}):Promise<{sent:number;deferred:number}>;
declare function resolveApiPrincipal(token:string,scope:string):Promise<Principal>;
```

**HTTP/entrada:** GET/POST /api/integrations para destinos e credenciais revisados; POST /:id/{rotate,revoke,retry}; GET /api/v1/leads e /events com Bearer escopado; comandoescrita reviewed via mesmo serviço de domínio, não CRUDlivre

**Regra executável:** Envelopev 1 emitido com efeito de domínio na mesmatransação; templates de eventos entram/qualifica/responde/agenda/handoff. HMACSHA256 corpo+timestamp com janela 5 min; recipient pode deduplicar eventid. Validar DNS/IP/HTTPS/redirecionamento em cada tentativa, bloquear redesprivadas; timeout 10 s/corpo 256KiB; retries 1 min/5 min/30 min/2 h/6 h até 24 h apenas 429/5 xx/rede. Incerto registrado e entrega at-least-once explícita, não prometer exactly-once externo. Tokenmetadata/segredo mostradosuma vez; revoke cancela pendências.

**UI:** `/settings/webhooks`, `/settings/apps`, `/executions/[id]`. Modal de destino, eventos, histórico/status/retentar e chave copiável reais; só mostrar entrega depois da resposta/receipt. Semtextarea de payload arbitrário.

**Gate externo/aceite:** Não enviar webhook de teste a URLexterna sem autorização. Piloto usa destino controlado com assinatura/idempotência verificados.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-07c1-api-webhooks.md).

### 07C.2 — Conectores de cliente e agenda/CRM

**Requisitos:** R16. **Dependências:** 07C.1.

**Persistência:** integration_connection, integration_mapping, integration_cursor, calendar_reservation; escopo/revisão/epoch por conexão; UNIQUE(workspace_id,connection_id,external_key)

**DTOs novos:**

```ts
type ConnectorInput={kind:"sheets"|"crm"|"apollo"|"calendar"|"meetings",name:string,credentialRef:string,expectedRevision:number};
type ConnectionView={id:string,kind:string,state:string,capabilities:string[],revision:number};
type SlotQuery={connectionId:string,from:string,to:string,timezone:string};
type CalendarSlot={id:string,start:string,end:string,available:boolean};
type SlotReservation={connectionId:string,slotId:string,conversationId:string,requestId:string};
type ConnectorMapping={connectionId:string,expectedRevision:number,destinationId:string,fieldMap:{sourceField:string,targetField:string}[],events:string[]};
type CalendarReservationView={id:string,connectionId:string,slotId:string,externalId:string|null,state:"prepared"|"accepted"|"uncertain"|"cancelled",revision:number};
```

**Serviços:**

```ts
declare function connectIntegration(p:Principal,input:ConnectorInput):Promise<ConnectionView>;
declare function syncIntegration(p:Principal,input:{connectionId:string;requestId:string}):Promise<EffectResult>;
declare function readCalendarSlots(p:Principal,input:SlotQuery):Promise<CalendarSlot[]>;
declare function reserveCalendarSlot(p:Principal,input:SlotReservation):Promise<EffectResult>;
declare function storeConnectorSecret(p:Principal,input:{kind:string;secret:string}):Promise<{credentialRef:string;expiresAt:string}>;
declare function prepareConnectorAuthorization(p:Principal,input:{kind:string;returnTo:string;requestId:string}):Promise<{authorizationUrl:string;stateId:string}>;
declare function saveConnectorMapping(p:Principal,input:ConnectorMapping):Promise<Versioned<ConnectorMapping>>;
declare function cancelCalendarReservation(p:Principal,input:{reservationId:string;requestId:string;expectedRevision:number}):Promise<EffectResult>;
```

**HTTP/entrada:** POST /api/integrations {kind,action:prepare-connect|confirm-connect|mapping,...}; callbackOAuthstate+PKCEquando suportado; POST /api/integrations/:id/sync; disconnect/revoke via 07C.1

**Regra executável:** Contrato Connector com read/upsert/slots/reserve apenas capacidades concedidas. Sheets export idempotente por leadId em coluna técnica, mapear campos e cursores. CRM upsert com originId sem sobrescrever campos humanos sem mapeamento. Apollo por conta do cliente quando conexão habilitada; preservar env central legado só em migração auditada, sem exigir chave Apify/LLM ao cliente. Agenda base Google Calendar OAuth e clock/timezone com lock local+id externo/reconciliação. CRM/reuniões só adaptador oficial documentado disponível; MeetFlow não é produto novo. Credenciais de conta criptografadas por workspace, callbacks não retornam tokens. Primeiro acesso: OAuth exige channels.manage/workspace.settings e origem/returnTo allowlisted; state+PKCE TTL10 min, uso único e vínculo usuário/workspace/provedor. APIkey entra somente POST /api/integrations/credentials (HTTPS, same-origin, segredo não logado), criptografada; credentialRef opaco TTL10 min, mesmo usuário/workspace/kind, consumo único. connectIntegration só resolve esse registro interno e nunca aceita chave ou referência de outro cliente. Callbacks guardam refresh/access no mesmo namespace. Mapping permite somente campos do Lead/contexto declarados, sem expressão/código e com validação de campo obrigatório. SlotId é token opaco por conexão/intervalo/fuso, TTL5 min; reservar relê disponibilidade. Cancelamento usa reservationId local, autoridade, revisão e remoteId guardado; caso incerto consulta antes de dizer cancelado. GoogleCalendar usa OAuth read-only+events conforme ação; Sheets usa conta própria e escopos mínimos de destino escolhido, cada grant informado na revisão. CRM/Apollo/reuniões usam authmode documentado no perfil; sem contrato o conector permanece indisponível.

**UI:** `/settings/apps`, `/settings/apps/google-sheets`, `/settings/apps/funnelsflow`, `/settings/apps/apollo`, `/settings/apps/meetflow`. Conectar→permissões→escolherdestino→mapear→revisar→estado/histórico, com desconexão real; estados nãoobservados são contrato próprio. Conta admin de fonte nunca aparecepara cliente.

**Gate externo/aceite:** CRM/MeetFlow/Apollo/Calendar exigem documentação oficial, credenciais próprias e acesso real. Sem contrato: registrar barreira e alternativa equivalente antesativar; não imitar sucesso. UsoGoogleCalendar é decisão técnica, não observação do backendCadenceFlow.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-07c2-customer-connectors.md).

### 07C.3 — MCP autenticado e comandos revisados

**Requisitos:** R17. **Dependências:** 07C.1, 06F, 06E.1.

**Persistência:** mcp_client_registration, mcp_grant, mcp_auth_code, mcp_refresh; tokenshashed, aud/redirect/escopos e consumo único por workspace/usuário

**DTOs novos:**

```ts
type McpRequest={jsonrpc:"2.0",id:string|number,method:string,params?:Record<string,unknown>};
type McpResult={content:{type:"text",text:string}[],isError?:boolean};
type McpToolCall={name:string,arguments:Record<string,unknown>};
type McpAuthorization={clientId:string,redirectUri:string,codeChallenge:string,scopes:string[],workspaceId:string};
```

**Serviços:**

```ts
declare function handleMcp(p:Principal,input:McpRequest):Promise<McpResult>;
declare function authorizeMcp(p:Principal,input:McpAuthorization):Promise<{code:string;expiresAt:string}>;
declare function executeMcpTool(p:Principal,input:McpToolCall):Promise<McpResult>;
```

**HTTP/entrada:** POST /api/mcp JSON-RPCStreamableHTTP; metadata discovery, authorization_code+PKCES256, refresh rotativo/revoke em /api/mcp/oauth/:action; consentem app autenticado, redirects registrados

**Regra executável:** Reaproveitar serviços de leitura/prepare/confirmUI e allowlisttools contacts.search/jobs.read/metrics.read/cadence.prepare/cadence.confirm/reply.prepare/reply.confirm. Advertise nenhumtool cujo domínio falhegate. Tokensaudiencebound TTL15 min, authorizationcode 60 s e refreshrotativo 7 dias com reuserevoke; confirmação expirada/schemaalterado rejeita. Sem servidorOAuth genérico do modelo ouCódexCLI; esteMCP opera oproduto. SDK novo só após consulta O Setup/documentação e seleção registrada; contrato HTTP não depende de fornecedor de LLM. Matriz de escopos fixa: contacts.read/jobs.read/metrics.read exigem membership atual e RLS; contacts.write e cadence.prepare exigem data.write; cadence.confirm exige cadences.publish quando publica e data.write quando apenas cria rascunho; reply.prepare/reply.confirm exigem messages.reply; toda seleção é interseção dos grants de cliente, escopos aprovados pelo usuário e capabilities do papel. authorizeMcp recebe Principal autenticado obtido de headers e confirma workspaceId correspondente, nunca cria sessão a partir do payload. GET /api/mcp/oauth/authorize mostra consentimento no app; POST confirma/rejeita, vincula grant a userId/workspaceId/clientId/audience/redirectUri/PKCE. Confirmtools recebem requestId e token de revisão ligado ao conteúdo exato, não uma aprovação genérica dochat. Retornar erro JSON-RPC tipado por autorização, input ou revisão sem expor internals.

**UI:** `/settings/mcp`, `/settings/security`, `shell:assistant`. URLcopiável, explicarpermissões, autorizar workspace, listarconexões e revogar; instruçõesClaude/ChatGPT usam endpoint funcional sem promessa de cliente suportado não testado.

**Gate externo/aceite:** Verificar especificaçãoMCP oficial na execução e homologar cliente compatível próprio. Sem registro/fluxoOAuth suportado não declarar integração pronta; contrato deautorização e tooloperation permanece fixo.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-07c3-mcp.md).

## Falhas, operação e critérios de pronto

Revalidar sessão/associação/política antes e depois de I/O. Não repetir efeito incerto; manter receipt e encaminhar à reconciliação. Cache, paginação e locks incluem workspace. Cada pacote deve passar caso feliz, bloqueio, falha/recuperação, permissão/isolamento e comparação visual no estado/viewport declarado, com evidência de execução real ou controlada separada.

Fora deescopo: funcionalidades não listadas no PRD, rebranding próprio, copiar backend privado não observado ou vender integração sem aceite. Parâmetros de fornecedor/implantação ficam nos gates; mudança de alternativa registra impacto e equivalência sem reabrir o produto inteiro.
