# Atendimento SDR opcional e supervisionado — desenho técnico

**Baseline:**27/10/2026. **Origem:** escopo aprovado e contrato próprio detalhado por solicitação do operador. Implementação pendente nos pacotes abaixo.

**PRD:** [completo](2026-10-27-prometeus-cadence-complete-prd.md). **Arquitetura/segurança/execução:** [contratos compartilhados](2026-10-27-prometeus-cadence-technical-contracts.md).

## Abordagem e reutilização

Adotar evolução dos serviços e telas existentes. Reescrita de backend ou segunda fila foi descartada porque duplicaria autoridade, quotas e efeitos. As escolhas técnicas complementam a aprovação do escopo; não são observações novas sobre o backend do CadenceFlow.

Base inspecionada:

- src/modules/settings/sdr-overview.tsx
- src/server/messaging/inbox.ts
- src/server/messaging/replies.ts
- src/server/prospecting/ai/settings.ts
- src/domain/ai-skills.ts

## Jornada

Configurar contexto/roteiro/canais/horário → simular → revisar/ativar → receber mensagem → turno/decisão → aprovação ou resposta delimitada → qualificação/handoff → agenda/CRM/follow-up autorizado.

## Regras e limites de responsabilidade

- Último módulo funcional novo obrigatório. A primeira publicação operacional usa WhatsApp; canais adicionais exigem capacidades reais já entregues. Não prometer automaçãoLinkedIn oficial irrestrita.
- Qualquer novo inbound relevante cancela follow-up de cadência; ativação do agente é decisão independente por workspace/canal/horário. Cliente pode tomar a conversa e suspender a IA.
- Uma thread tem controle de execução serial e epoch de atendimento; revalidar estado depois da LLM e antes do outbox. Cobrança técnica recebida pode ser preservada sem publicar resultado obsoleto.
- Conhecimento do cliente e memória são privados. Conteúdo coletado é dado, não autoridade para efetuar desconto, criar compromisso externo ou alterar políticas.
- Agenda/CRM só anunciam sucesso após efeito confirmado. Follow-up é limitado, consentido e submetido à janela/limite do canal; não existe bypass por chamar a ação de SDR.

## Contratos por pacote

### 07B.1 — Configuração e ativação do agente SDR

**Requisitos:** R19. **Dependências:** 06F, 07C.2, 07A.3, 07C.3.

**Persistência:** sdr_agent, sdr_agent_revision, sdr_knowledge, sdr_channel_binding; versão imutável de configuração ativada, FKcanais por workspace

**DTOs novos:**

```ts
type SdrDraft={id:string,expectedRevision:number,name:string,instructions:string,knowledgeIds:string[],channelIds:string[],hours:{timezone:string,weekdays:number[],start:string,end:string,allDay:boolean},qualification:{field:string,required:boolean}[],handoffMemberId:string,maxRepliesPerDay:number,approvalMode:"all"|"bounded-auto",followupEnabled:boolean,approvedFaqIds:string[]};
type SdrAgentView={id:string,revision:number,state:"draft"|"active"|"paused",contextVersion:number};
```

**Serviços:**

```ts
declare function saveSdrDraft(p:Principal,input:SdrDraft):Promise<Versioned<SdrDraft>>;
declare function prepareSdrActivation(p:Principal,input:{agentId:string;revision:number}):Promise<Reviewed<{agentId:string;revision:number}>>;
declare function confirmSdrActivation(p:Principal,input:Confirm<{agentId:string;revision:number}>):Promise<SdrAgentView>;
```

**HTTP/entrada:** GET/POST /api/sdr/agents para draft; POST /api/sdr/agents/:id/{prepare-activate,confirm-activate,pause}; conhecimento versionado via /api/sdr/knowledge

**Regra executável:** Começar WhatsApppadrão; e-mail/LinkedIn somente capacidadeenviorecebimentovalidada, sem prometer 24 h noofficialLinkedInassistido. Contexto/produtosaprovados maisconhecimento do cliente ficamdadosprivados; instruções geraisprotegidas. Roteiro/limites/perguntas/handoff/regras persistidos e validados; defaultsapprovalall e teto 20 respostas/dia em OpenWAcompartilhado com outrosenvios. Sandboxdryrun semenvioantesativação. Canaldesconectado/contextoremovido invalidaativação. followupEnabled=false por padrão; FAQ aprovada é resposta textual versionada com campos permitidos, sem negociação autônoma de preço. Ativar bounded-auto não autoriza ferramentas de escrita/agenda/CRM sem política e revisão específica.

**UI:** `/sdr`, `/settings/context`, `/settings/whatsapp`. Configuração/guiapopups no padrãoobservado oucontratopróprio rotulado quandoestado pago nãoobservado; ativação mostraescopo/canais/horários/limites/approvals.

**Gate externo/aceite:** Pro/assinaturaválida e capacidadesoperacionais antesativar; gatesde venda 06G sóapós 07B3.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-07b1-sdr-configuration.md).

### 07B.2 — Atendimento, memória e intervenção humana SDR

**Requisitos:** R20. **Dependências:** 07B.1, 06D.2.

**Persistência:** sdr_thread_state, sdr_turn, sdr_action; UNIQUE(workspace_id,thread_id,inbound_message_id), ownerhuman epoch e versão doagente

**DTOs novos:**

```ts
type SdrActionProposal={kind:"calendar-options"|"calendar-book"|"crm-upsert"|"followup-consent",parameters:Record<string,unknown>,evidenceIds:string[]};
type SdrGeneration={kind:"reply"|"qualify"|"handoff"|"abstain"|"propose-action",text:string,fields:Record<string,string>,evidenceIds:string[],faqId:string|null,action:SdrActionProposal|null};
type SdrAdapters={generate:(input:{context:string,history:string[],incoming:string})=>Promise<SdrGeneration>};
type SdrTurnResult={turnId:string,state:"pending-approval"|"queued"|"handed-off"|"abstained"|"blocked",messageId:string|null,proposalId:string|null};
```

**Serviços:**

```ts
declare function processSdrTurn(input:{threadId:string;inboundId:string},deps:SdrAdapters):Promise<SdrTurnResult>;
declare function takeOverSdr(p:Principal,input:{threadId:string;expectedRevision:number;requestId:string}):Promise<{owner:"human";revision:number}>;
declare function prepareSdrActionProposal(p:Principal,input:{turnId:string;proposal:SdrActionProposal}):Promise<{proposalId:string;state:"pending-approval"|"read-only"}>;
declare function sdrAutoReplyDecision(input:{faqId:string|null;approvedFaqIds:string[];allEvidenceActive:boolean;containsMutation:boolean;humanOwned:boolean}):"approved-template"|"needs-approval";
```

**HTTP/entrada:** GET /api/sdr/conversations?cursor; POST /api/sdr/conversations/:id/{takeover,resume,prepare-reply,approve-reply,reject-reply}; operação deenvio viaoutboxexistente

**Regra executável:** Umafila/turno porinbound e lockthread; contexto doagentepublicado e memóriaúltimas 20 mensagens +resumoevidenciado, nunca conteúdodeletado. Resultadoestrito, semshell/fetch/alterarpreço/inventarfatos. Fora dehorário adia com prazo/feedback; optoutparadefinitiva; humanoassumetravaepoch. Bounded-auto sóresposta deconhecimento evidenciado epermissãocanal; decisõesbaixa confiança/preçosnãoaprovados/objeçãoforaescopo viramapproval/handoff. Qualificaçãopropostacomorigem não substituiaplicação sempolítica. Roteamento do turno: propose-action passa por schema discriminado por kind (calendar-options: connectionId/from/to/timezone; calendar-book: reservation/slotId; crm-upsert: connectionId/leadId/fieldMapVersion; followup-consent: inboundId/channel/identityId/quote). Parâmetro/ID fora do contexto é rejeitado; ferramenta livre não existe. Persistir proposta ligada ao turn e epoch; consulta de slots é somente leitura e retorna opções reais. Escrita fica pending-approval até prepare/confirm dos serviços 07B.3, com UI de revisão; configuração de autonomia futura não ignora esse contrato. bounded-auto é server-side: somente render de FAQ id aprovado/versão ativa, evidências literais atuais, variáveis allowlisted, zero mutação, sem handoff/optout/limite. Texto livre da LLM, preço não aprovado, ausência de prova ou proposta de ação sempre precisam de aprovação. Falta de campo/faq gera needs-approval, não threshold inventado de confiança. Quota comercialSDR: reservar 1 unidade sdr por turnId antes da execução autorizada; consumir 1 somente quando uma respostaIA gera aceitação de envio confirmada no outbox. Abstenção/rascunho rejeitado/handoff puro liberam reserva. Retry não cobra novamente; uncertain mantém reserva até reconciliação. Agenda/CRM não cobram outra respostaSDR por si sós. Ledger técnicoLLM registra o custo recebido independentemente dessa cobrança, e limites mensais do plano/packs coexistem com limites diários do canal.

**UI:** `/sdr`, `/messages/whatsapp`, `/messages/email`, `/linkedin/approvals`. Históricoúnico mostra IA/humano, pendingapproval, aprovar/editar/rejeitar, assumir/retomar e motivo deabstenção. NenhumchatSDRparalelo fora dainbox.

**Gate externo/aceite:** Piloto conversacional comfontescontroladas antes debounded-auto; oficialLinkedIn exigeaçãohumana e não recebeenvio 24 hautomático.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-07b2-sdr-conversation.md).

### 07B.3 — Agenda, CRM, acompanhamento e piloto SDR

**Requisitos:** R21. **Dependências:** 07B.2, 07C.2, 06C.3.

**Persistência:** sdr_business_action, sdr_followup; UNIQUE(workspace_id,thread_id,action_key); vincular operação externa reservada/confirmada/uncertain; sdr_followup_consent com origem inbound/citação, finalidade, canal, identidade, versão de política, validade/revogação e ação humana responsável

**DTOs novos:**

```ts
type SdrBookingInput={threadId:string,calendarConnectionId:string,slotId:string,expectedRevision:number};
type SdrFollowupPolicy={maxAttempts:number,minDelayHours:number,requiresConsent:true};
// defaults próprios maxAttempts2,minDelayHours24, combinados com limitemaisrestritivo deconta/canal
type SdrCancellation={threadId:string,reservationId:string,expectedRevision:number};
type SdrCrmInput={threadId:string,connectionId:string,leadId:string,fieldMapVersion:number,expectedRevision:number};
type FollowupConsent={threadId:string,identityId:string,channel:"WHATSAPP"|"EMAIL"|"LINKEDIN",inboundId:string,quote:string,purpose:"conversation-followup",expiresAt:string};
```

**Serviços:**

```ts
declare function prepareSdrBooking(p:Principal,input:SdrBookingInput):Promise<Reviewed<SdrBookingInput>>;
declare function confirmSdrBooking(p:Principal,input:Confirm<SdrBookingInput>):Promise<EffectResult>;
declare function runSdrFollowupTick(input:{limit:number;signal:AbortSignal}):Promise<{queued:number;blocked:number}>;
declare function cancelSdrBooking(p:Principal,input:Confirm<SdrCancellation>):Promise<EffectResult>;
declare function prepareSdrCancellation(p:Principal,input:SdrCancellation):Promise<Reviewed<SdrCancellation>>;
declare function prepareSdrCrm(p:Principal,input:SdrCrmInput):Promise<Reviewed<SdrCrmInput>>;
declare function confirmSdrCrm(p:Principal,input:Confirm<SdrCrmInput>):Promise<EffectResult>;
declare function recordSdrFollowupConsent(p:Principal,input:FollowupConsent):Promise<{id:string;active:boolean}>;
```

**HTTP/entrada:** POST /api/sdr/conversations/:id/{prepare-booking,confirm-booking,cancel-booking,prepare-crm,confirm-crm}; atividadesplanejadas via /api/sdr/actions, limitadas aos mesmosserviços

**Regra executável:** Sugerir slots do serviço real; confirmar reserva só após resposta do provedor, validar de novo disponibilidade/hash. CRM com campos permitidos, idempotência por origem; nunca dizer agendado antes da aceitação. Followup só com autorização registrada pela conversa/política do cliente, máximo 2 retornos separados>=24 h e parada com humano/optout/resposta. Fora da janela exige template aprovado onde o canal exigir; sem template bloqueia. Piloto transversal contextualiza empresa→responde→qualifica→agenda→CRM→métricasnotificação; cleanup de eventos de teste autorizado. O consentimento é fato separado da inferênciaLLM: proposta followup-consent extrai citação literal de inbound existente, e humano confirma a finalidade/canal/validade na UI. Mensagem genérica ou simples resposta não vira autorização de follow-up. ExpiresAt máximo 30 dias como default próprio; optout/retirada/novo human takeover revogam e impedem scheduler. Ações CRM e cancelar agendamento usam os mesmos princípios prepare/confirm/revisão/epoch do booking. ConfirmSdrCrm delega mapeamento/schema/upsert ao conector 07C.2; cancelSdrBooking delega cancelCalendarReservation e aguarda prova. Proposta é um draft, nunca compromisso aceito no calendário.

**UI:** `/sdr`, `/messages/whatsapp`, `/settings/apps`, `/reports`. Cards deagenda/CRMcomstatusconfirmado/pendente, opçõeshumano/cancelar eáreas detrabalho existentes; não conduzirusuário a endpointtécnico.

**Gate externo/aceite:** ConcluirSDR exige piloto autorizado; não venderatéaceite. Integraçãoexternanãodisponível épendênciaoperacional, não “testada” poradapterfake.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-07b3-sdr-actions-pilot.md).

## Falhas, operação e critérios de pronto

Revalidar sessão/associação/política antes e depois de I/O. Não repetir efeito incerto; manter receipt e encaminhar à reconciliação. Cache, paginação e locks incluem workspace. Cada pacote deve passar caso feliz, bloqueio, falha/recuperação, permissão/isolamento e comparação visual no estado/viewport declarado, com evidência de execução real ou controlada separada.

Fora deescopo: funcionalidades não listadas no PRD, rebranding próprio, copiar backend privado não observado ou vender integração sem aceite. Parâmetros de fornecedor/implantação ficam nos gates; mudança de alternativa registra impacto e equivalência sem reabrir o produto inteiro.
