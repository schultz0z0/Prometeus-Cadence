# Autoria e operação dos canais — desenho técnico

**Baseline:**27/10/2026. **Origem:** escopo aprovado e contrato próprio detalhado por solicitação do operador. Implementação pendente nos pacotes abaixo.

**PRD:** [completo](2026-10-27-prometeus-cadence-complete-prd.md). **Arquitetura/segurança/execução:** [contratos compartilhados](2026-10-27-prometeus-cadence-technical-contracts.md).

## Abordagem e reutilização

Adotar evolução dos serviços e telas existentes. Reescrita de backend ou segunda fila foi descartada porque duplicaria autoridade, quotas e efeitos. As escolhas técnicas complementam a aprovação do escopo; não são observações novas sobre o backend do CadenceFlow.

Base inspecionada:

- src/domain/cadence.ts
- src/server/messaging/publication-v 2.ts
- src/server/messaging/outbox.ts
- src/server/messaging/dispatch.ts
- src/server/mail/threading.ts

## Jornada

Fonte de criação → versão editável → preview/variáveis/anexos → revisão → publicação imutável → enrollment/outbox → aceitação/recibo → inbox → parada/opt-out/handoff.

## Regras e limites de responsabilidade

- Reutilizar os contratos de canal, publicaçãoV2, consentimento, janela de atendimento, limites e reconciliação existentes. Nenhuma segunda fila de envio para IA ouSDR.
- Congelar variante/versão/arquivo/variáveis ao publicar; reenvio conserva identidade. Arquivo privado não fica empublic nem em URL externa escolhida pelo modelo.
- Recebimento humano pausa o follow-up por identidade/contato conforme política; reply automático/DSN não é resposta humana. Inbox usa threads comprovadas, não apenas assunto semelhante.
- Ready/QR/OAuth não prova entrega. SMTPaccepted não prova leitura; null representa medição indisponível. Uso de anexos/telemetria depende da capacidade real.

## Contratos por pacote

### 06D.1 — Autoria, variantes, anexos e publicação

**Requisitos:** R07, R08. **Dependências:** 06B.4, 05.

**Persistência:** cadence_content_revision, cadence_variant, message_attachment; vínculo à publicação imutável ehash do conteúdo; variantes determinísticas por enrollment

**DTOs novos:**

```ts
type ContentDraft={cadenceId:string,expectedRevision:number,steps:{id:string,channel:"EMAIL"|"WHATSAPP"|"LINKEDIN",body:string,subject?:string,variant?:"A"|"B",attachmentIds:string[]}[]};
type ContentPublication={cadenceId:string,contentRevision:number};
type AttachmentUpload={name:string,mime:string,bytes:Uint8Array};
type AttachmentView={id:string,name:string,mime:string,size:number,state:"pending"|"ready"|"rejected"};
```

**Serviços:**

```ts
declare function saveCadenceContent(p:Principal,input:ContentDraft):Promise<Versioned<ContentDraft>>;
declare function prepareContentPublication(p:Principal,input:ContentPublication):Promise<Reviewed<ContentPublication>>;
declare function storeAttachment(p:Principal,file:AttachmentUpload):Promise<AttachmentView>;
```

**HTTP/entrada:** POST /api/message-content {action:save|prepare-publish|confirm-publish,cadenceId,expectedRevision,...}; POST /api/message-files multipart restrito; GET /api/message-files/:id com autorização; publicação continua usando /api/messaging/publications

**Regra executável:** Conectar modos manual/IA/assistente/modelo à mesma revisão de conteúdo. Preservar edição concorrente e rascunho; publicação congela versão/variáveis/attachments. DivisãoA/B50/50 determinística por enrollment, sem rerrolar ao retry; desabilitada se faltar variante completa. Reusar preparePublicationV2 com bases estendidas. Blob privado 10MiB/5 arquivos; bytesMIME/hash, estado de verificação e suporte do canal antes do envio.

**UI:** `/cadences/new`, `/cadences/[id]`, `/templates`, `/automations/new/ai`. Todos os controles do editor, preview de variáveis, varianteB, anexos, templates, agenda e revisão precisam persistir e alterar o executor. Nenhum botão de envio na sugestão.

**Gate externo/aceite:** Arquivos privados precisam de volume durável no deploy. Provedor que não aceitar conteúdo/anexo não pode ser habilitado com base só na UI.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-06d1-message-authoring.md).

### 06D.2 — Canais, inbox e homologação de entrega

**Requisitos:** R09. **Dependências:** 06D.1.

**Persistência:** estender vínculos de recibo/consentimento/inbox existentes; novos índices por workspace/remotereference; não recriar outbox ou canal

**DTOs novos:**

```ts
type DeliveryEvidence={messageId:string,state:string,acceptedAt:string|null,deliveredAt:string|null,readAt:string|null,supported:string[]};
type ChannelPilotInput={connectionId:string,ownedRecipient:string,reviewToken:string,requestId:string};
type PilotAdapters={observe:(remoteId:string)=>Promise<DeliveryEvidence>};
type PilotResult={outboundId:string,inboundId:string|null,delivery:DeliveryEvidence,stoppedEnrollment:boolean};
```

**Serviços:**

```ts
declare function readDeliveryEvidence(p:Principal,messageId:string):Promise<DeliveryEvidence>;
declare function runChannelPilot(p:Principal,input:ChannelPilotInput,deps:PilotAdapters):Promise<PilotResult>;
```

**HTTP/entrada:** Reusar /api/channels/:id/:action, /api/mailboxes/:id/:action e /api/messaging/:resource/:id/:action para teste/reply/read/reconcile; acrescentar evidência suportada ao DTO existente, semendpoint paralelo de envio

**Regra executável:** Cobrir conectar/verificar/revogar/recuperar Meta/OpenWA/Gmail/SMTPIMAP comcontratos atuais. Vincular thread enviado/recebido e ações de leitura apenas aplicativo. Recibo fora de ordem não regride estado; resposta humana/optout trava materialização pendente. Reconciliarincerto antes de reenviar; anexos e variante congelados seguemreceipt. Corrigir separações indevidas de thread somente com cabeçalhos/IDs provados.

**UI:** `/settings/whatsapp`, `/settings/email`, `/messages/whatsapp`, `/messages/email`, `/cadences/[id]`. Conexão permanece em cartõeslimpos e popups; histórico agrupa threads, colapsa citações e mantém rascunho/scroll; falha mostraação útil e estadoreal.

**Gate externo/aceite:** Piloto real sócom contas/destinatários próprios, orçamento e ações explícitas autorizadas. Não enviar automaticamente para números antigos deprints.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-06d2-channel-operation.md).

## Falhas, operação e critérios de pronto

Revalidar sessão/associação/política antes e depois de I/O. Não repetir efeito incerto; manter receipt e encaminhar à reconciliação. Cache, paginação e locks incluem workspace. Cada pacote deve passar caso feliz, bloqueio, falha/recuperação, permissão/isolamento e comparação visual no estado/viewport declarado, com evidência de execução real ou controlada separada.

Fora deescopo: funcionalidades não listadas no PRD, rebranding próprio, copiar backend privado não observado ou vender integração sem aceite. Parâmetros de fornecedor/implantação ficam nos gates; mudança de alternativa registra impacto e equivalência sem reabrir o produto inteiro.
