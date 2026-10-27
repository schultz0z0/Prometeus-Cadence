# LinkedIn operacional e capacidades comprovadas — desenho técnico

**Baseline:**27/10/2026. **Origem:** escopo aprovado e contrato próprio detalhado por solicitação do operador. Implementação pendente nos pacotes abaixo.

**PRD:** [completo](2026-10-27-prometeus-cadence-complete-prd.md). **Arquitetura/segurança/execução:** [contratos compartilhados](2026-10-27-prometeus-cadence-technical-contracts.md).

## Abordagem e reutilização

Adotar evolução dos serviços e telas existentes. Reescrita de backend ou segunda fila foi descartada porque duplicaria autoridade, quotas e efeitos. As escolhas técnicas complementam a aprovação do escopo; não são observações novas sobre o backend do CadenceFlow.

Base inspecionada:

- src/modules/settings/linkedin-sdr.tsx
- src/server/auth/permissions.ts
- src/server/prospecting/providers/profiles.ts
- src/server/messaging/publication-v 2.ts

## Jornada

07A.0 prova capacidades → conexão por cliente → público real → rascunho/revisão → convite autorizado → aceite sincronizado → pessoa/pipeline/enriquecimento → mensagem permitida/revisada.

## Regras e limites de responsabilidade

- 07A.0 é gate de fornecedor/permissões e pode ser antecipado. LoginOAuth por si só não comprova busca, convite, recebimento ou envio.
- A documentação oficialMessages exige ação afirmativa específica e edição do rascunho no momento; modoassisted bloqueia envio porcron. Um modoautomático depende de outro contrato comprovado e decisão registrada.
- Captar dados deperfil pelaApify é separado de operar aconta LinkedIn do cliente. Nenhuma associação pessoal é inferida só por mesmo nome.
- Visita/like/comentário e aquecimento visíveis precisam de capacidade e executor ou bloqueio explícito; não se tornam promessa de baixo risco. Convites/mensagens só a contas próprias autorizadas nospilotos.
- Caso um adaptador não satisfaça a automação-alvo, registrar pendência e buscar alternativa. Não encerrar paridade operacional trocando silenciosamente o requisito por tarefa manual.

## Contratos por pacote

### 07A.0 — Viabilidade e capacidades do LinkedIn

**Requisitos:** R18. **Dependências:** 06IA, 06E.1.

**Persistência:** linkedin_capability_profile; versão do adaptador, grants comprovados, expiração/revogação e evidência da habilitação; somenteadmin configura infraestrutura

**DTOs novos:**

```ts
type LinkedinCapabilities={version:string,connect:boolean,audience:boolean,invite:boolean,acceptance:boolean,readMessages:boolean,sendMessage:"unavailable"|"assisted"|"automatic",profileActions:string[],verifiedAt:string|null};
type AdapterAttestation={adapterId:string,agreementRef:string,expiresAt:string,capabilities:LinkedinCapabilities,evidenceRefs:string[]};
```

**Serviços:**

```ts
declare function readLinkedinCapabilities(p:Principal):Promise<LinkedinCapabilities>;
declare function validateLinkedinAdapter(input:AdapterAttestation):Promise<LinkedinCapabilities>;
```

**HTTP/entrada:** GET /api/linkedin/capabilities será servido em 07A.1; administração protegida reaproveita autoridadeplatformAI sem entregargrantsecret ao cliente

**Regra executável:** Matrizaçãoverificável por capacidade: contaOAuth, search/postaudience, convite/nota, aceites, inbox, mensagens, visita/like/comentário observados. OficialMessages exige açãoafirmativaeditável no momento: modoassistedsemcron. CapturardadosApify não concede ação de conta. Capacidade não comprovada desliga botão/executor. Comparar alternativa de conector com operação equivalente, custo/permissões e contrato antes decidir; não instalaroucontratar nesta prova sem autorização específica.

**UI:** `/linkedin/dashboard`, `/linkedin/campaigns/new`, `/linkedin/approvals`. Estimativa comercial rotuladailustrativa, requisitos reais e motivo de indisponibilidade. Não alterar geometria para esconder limitação do fornecedor.

**Gate externo/aceite:** 07A.0 fecha com decisão de viabilidade documentada, não com aprovação automática de paridade operacional. Seautomaçãoalvo não disponível, alternativa deve satisfazer requisito ou permanecerpendência explícita antes fechar 07A.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-07a0-linkedin-feasibility.md).

### 07A.1 — Conexão, saúde e sincronização LinkedIn

**Requisitos:** R18. **Dependências:** 07A.0, 07C.2.

**Persistência:** linkedin_account, linkedin_sync_cursor, linkedin_account_event; UNIQUE(workspace_id,external_member_id), credentialepoch eremoteidscoped

**DTOs novos:**

```ts
type LinkedinAccountView={id:string,displayName:string,state:"connecting"|"ready"|"restricted"|"revoked"|"error",capabilities:LinkedinCapabilities,lastSyncAt:string|null,revision:number};
// tokens criptografados ficam somente no servidor, callbacks nuncaos retornam
```

**Serviços:**

```ts
declare function prepareLinkedinConnection(p:Principal,input:{name:string}):Promise<Reviewed<{name:string}>>;
declare function syncLinkedinAccount(p:Principal,input:{accountId:string;requestId:string}):Promise<{state:string;cursor:string|null}>;
declare function revokeLinkedinAccount(p:Principal,accountId:string):Promise<void>;
```

**HTTP/entrada:** GET /api/linkedin/capabilities; POST /api/linkedin/accounts {action:prepare-connect|confirm-connect}; POST /api/linkedin/accounts/:id/{sync,reconnect,revoke}; OAuthcallback comstateproveniente do servidor

**Regra executável:** Conexão por workspace comscopes/capacidade comprovados e OAuthstate/PKCEseconector suportar. Refresh e revogação invalidam comandos/leases. Sync paginado diferencial máximo 100 itens/tick e cursorsalvo comresultados; backoff 429/bloqueio explicitado, sem ciclo de reconectar incessante. Eventos sincronizadoscomremoteId estável,sem criar mensagens outboundfalsas. Conta não pode servir de conexão compartilhada central.

**UI:** `/linkedin/dashboard`, `/linkedin/campaigns`, `/linkedin/people`. Popupconexão/conta/status/erro/reconectar/revogar real; indicador mostraúltima sync em vez de fingirtempo real contínuo. Foco/mobile e cancelamentoOAuth corretos.

**Gate externo/aceite:** Requer conta própria egrantoperacional disponível; sucessoOAuthsozinho nãofecha teste de mensagens/campanhas.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-07a1-linkedin-connection.md).

### 07A.2 — Públicos, campanhas, convites e aceites LinkedIn

**Requisitos:** R18. **Dependências:** 07A.1, 06B.5.

**Persistência:** linkedin_campaign, linkedin_campaign_person, linkedin_invite_operation; UNIQUE(workspace_id,campaign_id,person_external_id), fila e revisão congeladas

**DTOs novos:**

```ts
type LinkedinCampaignDraft={id:string,name:string,accountId:string,expectedRevision:number,source:{mode:"filters"|"post",roles:string[],locations:string[],industries:string[],postUrl?:string,degrees:number[]},note:string,dailyLimit:number,acceptListId:string|null,otherListId:string|null,enrichOnAccept:boolean};
type CampaignPersonView={id:string,state:"candidate"|"review"|"queued"|"invited"|"accepted"|"failed"|"uncertain",remoteId:string|null};
```

**Serviços:**

```ts
declare function saveLinkedinCampaign(p:Principal,input:LinkedinCampaignDraft):Promise<Versioned<LinkedinCampaignDraft>>;
declare function prepareLinkedinCampaign(p:Principal,input:{id:string;revision:number}):Promise<Reviewed<{id:string;revision:number}>>;
declare function runLinkedinInviteTick(options:{limit:number;signal:AbortSignal}):Promise<{accepted:number;uncertain:number}>;
```

**HTTP/entrada:** GET /api/linkedin/campaigns; POST para save/prepare/confirm; POST /api/linkedin/campaigns/:id/{pause,resume,cancel}; GET /api/linkedin/audience?campaignId&cursor; prévias de coleta com confirmação de custo

**Regra executável:** Filtros reais porcontrato;unsupportedfield dá 422 emvezignorar. Extrair público depost só fontegrantvalidada. Notapersonalizável com IA central e variáveispermitidas; semfato inventado. Ritmo inicial máximo 12 convites/dia ou menorlimiteconcedido, semgarantia de conta segura. Warmup/visita/like/comentário só executam sobcapacidade e revisão, senãobloqueadoscom motivo. Aceite é evento remotecomprovado, gera destino/enrichment revisadoconformeconfig, não dadoestimado.

**UI:** `/linkedin/campaigns`, `/linkedin/campaigns/new`, `/linkedin/dashboard`. Todoschips/filtros/post/nota/ritmo/destinos/quaisquercontrolesvisíveis têm persistência e efeito. Revisão mostra público real separado de estimativa.

**Gate externo/aceite:** Limite 12 é teto inicial conservador próprio, não política do LinkedIn nem promessa depermissão. Nãoenviar convites a terceiros em QA.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-07a2-linkedin-campaigns.md).

### 07A.3 — Pessoas, pipeline, mensagens e aprovações LinkedIn

**Requisitos:** R18. **Dependências:** 07A.2, 06D.2, 06B.4.

**Persistência:** linkedin_thread, linkedin_message, linkedin_approval, linkedin_pipeline_move; FKworkspace/pessoa/conta; remoteIDs únicos porconta

**DTOs novos:**

```ts
type LinkedinReply={accountId:string,threadId:string,body:string,expectedRevision:number,actionNonce:string};
// actionNonce emitido na revisão e vinculado à ação humana recente<=60s apenas para modoassisted
// LinkedInAPI exige publicação no momento da ação, não liberação decron
// aprovação paraothermodo segue capacidade
```

**Serviços:**

```ts
declare function prepareLinkedinReply(p:Principal,input:LinkedinReply):Promise<Reviewed<LinkedinReply>>;
declare function confirmLinkedinReply(p:Principal,input:Confirm<LinkedinReply>):Promise<EffectResult>;
declare function moveLinkedinPerson(p:Principal,input:{personId:string;stage:string;expectedRevision:number;requestId:string}):Promise<Versioned<{stage:string}>>;
```

**HTTP/entrada:** GET /api/linkedin/{people,pipeline,conversations,approvals}; POST /api/linkedin/conversations/:id/{prepare-reply,confirm-reply}; POST approvals/:id/{approve,reject}; moverpipeline porrevision/requestId

**Regra executável:** Conversasepessoas provenientessincroniaaccount 07A1; listagem/pipeline persistem, enriquecimento usa 06B4 e não credencialsource deoutraempresa. Templates e pósaceitecompartilham autoria 06D; modooficialassistido cria tarefas/rascunhospararevisar, nunca envios automáticos. Modoautomatic sóapós 07A0 comprovar conector/contrato. Respostapausa cadência,approvalinvalidaemedit e humanhandoff travaSDR.

**UI:** `/linkedin/people`, `/linkedin/pipeline`, `/linkedin/enrichment`, `/linkedin/approvals`, `/linkedin/cadences`, `/linkedin/templates`. Eliminar telasgenéricas vazias: listas/detalhe/pipeline/editor/aprovações comloading/vazio/bloqueio/falha/sucesso e revisão editável. Métodoassistidoexplicitado juntoàação.

**Gate externo/aceite:** 07A não éparidadeoperacional completa se ações alvo continuarem indisponíveis; registrar alternativa/decisão em vez de considerar assis­tido equivalente a automático.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-07a3-linkedin-conversations.md).

## Falhas, operação e critérios de pronto

Revalidar sessão/associação/política antes e depois de I/O. Não repetir efeito incerto; manter receipt e encaminhar à reconciliação. Cache, paginação e locks incluem workspace. Cada pacote deve passar caso feliz, bloqueio, falha/recuperação, permissão/isolamento e comparação visual no estado/viewport declarado, com evidência de execução real ou controlada separada.

Fora deescopo: funcionalidades não listadas no PRD, rebranding próprio, copiar backend privado não observado ou vender integração sem aceite. Parâmetros de fornecedor/implantação ficam nos gates; mudança de alternativa registra impacto e equivalência sem reabrir o produto inteiro.
