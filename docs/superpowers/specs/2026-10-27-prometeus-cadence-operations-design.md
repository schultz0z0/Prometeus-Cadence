# Métricas, comunicação, segurança e experiência — desenho técnico

**Baseline:**27/10/2026. **Origem:** escopo aprovado e contrato próprio detalhado por solicitação do operador. Implementação pendente nos pacotes abaixo.

**PRD:** [completo](2026-10-27-prometeus-cadence-complete-prd.md). **Arquitetura/segurança/execução:** [contratos compartilhados](2026-10-27-prometeus-cadence-technical-contracts.md).

## Abordagem e reutilização

Adotar evolução dos serviços e telas existentes. Reescrita de backend ou segunda fila foi descartada porque duplicaria autoridade, quotas e efeitos. As escolhas técnicas complementam a aprovação do escopo; não são observações novas sobre o backend do CadenceFlow.

Base inspecionada:

- src/server/operations/repository.ts
- src/server/messaging/metrics.ts
- src/server/auth/auth.ts
- src/server/auth/permissions.ts
- src/modules/settings/reference-settings.tsx
- src/components/shell/assistant-panel.tsx

## Jornada

Eventos e tabelas autoritativas → projeção/relatório → notificação conforme preferência → ação autorizada → resultado persistido; segurança e ciclo de dados atravessam todos os passos.

## Regras e limites de responsabilidade

- Fuso e período absolutos são autoritativos; somas de tentativas não são mensagens únicas. Eventos invalidam consulta, não transportam corpos pessoais.
- Notificações pertencem ao usuário/workspace e à preferência atual. Modo de silêncio e destino verificado são verificados antes da entrega, não apenas ao salvar.
- Segurança usa a versãoBetterAuth instalada e as invariantes transacionais atuais. Não confiar emcapabilitiesUI, cookies pré-desafio ou confirmação dechat como autoridade adicional.
- Exclusão/retenção invalidam evidências, pesquisa, exportação e contexto de IA. Fusão conserva opt-out e histórico, desfazer exige bases intactas.
- Assistente é orquestrador de propostas e leituras permitidas, sem shell/SQL arbitrário. Onboarding deriva marcos operacionais reais e não confunde abrir uma tela com integrar um canal.

## Contratos por pacote

### 06C.2 — Dashboard, relatórios e execuções reconciliados

**Requisitos:** R10. **Dependências:** 06D.2, 06B.5, 06C.1.

**Persistência:** report_projection_checkpoint, report_daily_projection; UNIQUE(workspace_id,projection_version,period,key); replay ordenado sem alterar fontes

**DTOs novos:**

```ts
type ReportQuery={view:"dashboard"|"cadences"|"executions"|"funnel",from:string,to:string,timezone:string,cadenceId?:string,cursor?:string};
type ReportView={period:{from:string,to:string,timezone:string},totals:Record<string,number|null>,series:{date:string,values:Record<string,number|null>}[],items:unknown[],nextCursor:string|null,asOf:string,stale:boolean};
```

**Serviços:**

```ts
declare function readReport(p:Principal,input:ReportQuery):Promise<ReportView>;
declare function rebuildReportProjection(p:Principal,input:{from:string;to:string}):Promise<{checkpoint:string;rows:number}>;
```

**HTTP/entrada:** GET /api/reports?view=dashboard|cadences|executions|funnel&from&to&timezone&cadenceId&cursor; GET /api/reports/:id para detalhe autorizado

**Regra executável:** Projetar fatos por identidade/etapa/publicação e consumir eventos existentes; backfill limitado e retomável. Definir numerador/denominador de cada KPI no domínio. Somar mensagens únicas e respostas humanas sem contar tentativas, períodos UTCabsolutos agrupados pelo fuso. Corrigir bounces/opt-outs por cadência que hoje voltam 0 apenas por haverfiltro. Drilldown usa mesmaquerybase; exporte colunaindisponível comnull. Sem snapshot inteiro para relatório.

**UI:** `/dashboard`, `/reports`, `/reports/[tab]`, `/executions`, `/executions/[id]`, `/cadences/[id]`. Filtros, cards, gráficos, funil, tabela e detalhe seguem referência; mostrar atualização/indisponível/erro sem inventar dados. Evento atualiza consulta preservando período e edição.

**Gate externo/aceite:** Projeção pode ser reconstruída; indicadoratualizado só após checkpoint confirmado. Métrica não fornecida pelo canal continua indisponível.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-06c2-reconciled-reports.md).

### 06C.3 — Notificações, preferências e resumos

**Requisitos:** R11. **Dependências:** 06C.2.

**Persistência:** notification_preference, notification_item, notification_delivery, scheduled_summary; UNIQUE(workspace_id,user_id,event_key,channel)

**DTOs novos:**

```ts
type NotificationPreferences={expectedRevision:number,events:string[],email:boolean,whatsapp:boolean,sound:boolean,badge:boolean,quiet:{timezone:string,start:string,end:string}|null,summary:{frequency:"off"|"daily"|"weekly",time:string}};
type NotificationItem={id:string,eventKey:string,title:string,href:string,readAt:string|null,createdAt:string};
```

**Serviços:**

```ts
declare function saveNotificationPreferences(p:Principal,input:NotificationPreferences):Promise<Versioned<NotificationPreferences>>;
declare function listNotifications(p:Principal,cursor?:string):Promise<Page<NotificationItem>>;
declare function processNotificationTick(options:{limit:number;signal:AbortSignal}):Promise<{delivered:number;deferred:number}>;
```

**HTTP/entrada:** GET /api/notifications?cursor; POST /api/notifications {action:preferences,expectedRevision,input}; POST /api/notifications/:id/read; GET preferences com modo explícito

**Regra executável:** Convertereventos confirmados em itens porusuário e preferências. Somapenas após gesto/permissão do browser, sem autoplay quebrado. Quiet window cruza meia-noite/fuso e adia, não duplica. Destinosemailtelefone vêm de conta verificada ou canal configurado, sem bodydestination arbitrário. Resumos agrupam fatosdo período comchaveúnica. Ativossemcapacidade ficam adiados/erro útil; SLA não inventa WhatsAppsend gratuita.

**UI:** `/settings/notifications`, `/settings/account`, `/dashboard`. Feed/contador e toggles da referência ficam operacionais, com estado de destino pendente e feedback de salvar; nenhuma notificação marca conversa remota como lida.

**Gate externo/aceite:** Provedor de avisos e destino verificado necessários ao aceiteexterno. Testes locais usam capturadores; não enviar ao operador por simples teste de preferências.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-06c3-notifications.md).

### 06E.1 — Autenticador, sessões e administração de membros

**Requisitos:** R01, R12. **Dependências:** 02, 06A-P, 06A-H.

**Persistência:** migração gerada da versão localBetterAuthtwoFactor e registrodesafio recente; usar auth.member/session existentes e invariantes de últimoowner

**DTOs novos:**

```ts
type TotpChallenge={id:string,userId:string,expiresAt:string,verifiedAt:string|null};
type MembershipChange={memberId:string,expectedRevision:number,role:"owner"|"admin"|"operator",requestId:string};
// estruturas internas TOTP/backup da biblioteca, sem reimplementar algoritmo
```

**Serviços:**

```ts
declare function prepareTotp(headers:Headers,input:{password:string}):Promise<{challengeId:string;uri:string;backupCodes:string[]}>;
declare function verifyTotp(headers:Headers,input:{challengeId:string;code:string}):Promise<{enabled:boolean}>;
declare function disableTotp(headers:Headers,input:{password:string;code:string}):Promise<void>;
```

**HTTP/entrada:** POST /api/security/two-factor/{prepare,verify,disable,recovery}; reusar /api/security e comandosmembership; authchallenge só retorna sessão plena após verificação

**Regra executável:** Reusar módulo twoFactor já incluído em BetterAuth instalado; verificar métodos/tipos locais e migraçãogerada antes de usar. Senha+TOTP/backup desafiam login, códigos usadosuma vez e rate-limit. OAuthsempassword não ligaTOTP por mudança de flagcliente: reautenticaçãofresca e método suportadopela versão ou setup explícito de senha verificada antes. Sessões/desafios/backup nunca logados; APIs existentes não podem ignorar challenge. Convites/roles/capacidadecom lockinvariantes no servidor.

**UI:** `/settings/security`, `/settings/seats`, `/accept-invitation`, `/login`, `/reset-password`. QRsegredoTOTP somente popupprivado; backup visíveluma vez econfirmaçãoantesfechar. Sessões/membros exibemresultado persistido e recuperação clara mobile.

**Gate externo/aceite:** Nenhuma biblioteca/pluginCodexnovo é necessário. Schema/exports locais prevalecem sobre documentação mais recente; recuperação preserva prova de identidade.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-06e1-security-members.md).

### 06E.2 — Duplicados, fusão, privacidade e ciclo dos dados

**Requisitos:** R13. **Dependências:** 06E.1, 06B.4.

**Persistência:** merge_record, data_request, retention_policy, data_tombstone; unicidade de solicitação e snapshot privado com expiração

**DTOs novos:**

```ts
type MergeInput={targetId:string,sourceIds:string[],expectedRevision:number,fieldChoices:Record<string,string>};
type MergeView={id:string,state:"merged"|"undone"|"conflict",undoUntil:string};
type DataRequest={kind:"export"|"delete"|"retention",leadIds:string[],requestId:string,retentionDays?:number};
```

**Serviços:**

```ts
declare function prepareMerge(p:Principal,input:MergeInput):Promise<Reviewed<MergeInput>>;
declare function confirmMerge(p:Principal,input:Confirm<MergeInput>):Promise<MergeView>;
declare function undoMerge(p:Principal,input:{mergeId:string;expectedRevision:number;requestId:string}):Promise<MergeView>;
declare function requestDataLifecycle(p:Principal,input:DataRequest):Promise<{id:string;state:string}>;
```

**HTTP/entrada:** POST /api/data-lifecycle {action:scan|prepare-merge|confirm-merge|prepare-delete|confirm-delete|export|retention,input,token?,requestId?}; POST /:id/undo; GET /api/data-lifecycle?id=... para progresso/download autorizado

**Regra executável:** Scan paginado base completa com CNPJ/email/phone normalizados semusar nome comoidentidade. Fusão preserva vínculos históricos/consentimento mais restritivo; arquivaorigens, não duplica quota. Desfazeraté 7 dias sóse revisões afetadas intactas; conflitoretorn 409, jamais sobrescrever mudançasnovas. Retenção desligada porpadrão; ativa 7/30/90/180/365 dias escolhidos explicitamente, texto/anexos apagados em lotes. Tombstone invalida cache/evidência/IA/busca/exports; trilha mínima semcorpo. Exportprivado expira 24 h; links 5 min.

**UI:** `/settings/dados`, `/settings/privacy`, `/contacts`, `/leads/[id]`. Procurar→comparar campos→revisar→fundir→histórico/desfazer, com estados reais. Privacidade mostra escopo/consequência e progresso, não toggledecorativo.

**Gate externo/aceite:** Políticade retenção financeira/jurídica separa metadados obrigatórios de conteúdo. Não oferecer restauração após expurgo físico ou após conflito.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-06e2-data-lifecycle.md).

### 06F — Assistente, busca, onboarding e ajuda

**Requisitos:** R14. **Dependências:** 06C.3, 06E.2, 06IA.

**Persistência:** assistant_thread, assistant_proposal, onboarding_progress; usuário/workspace e versão de contexto separados; sem credencial no histórico

**DTOs novos:**

```ts
type AssistantInput={threadId?:string,text:string,contextRoute:string};
type AssistantCommand={kind:"create-cadence"|"create-audience-automation"|"qualify-list"|"draft-reply",payload:Record<string,unknown>};
type AssistantReply={threadId:string,text:string,citations:{kind:string,id:string}[],proposalIds:string[]};
type SearchQuery={q:string,kinds:string[],cursor?:string};
type SearchHit={kind:string,id:string,label:string,href:string};
```

**Serviços:**

```ts
declare function answerAssistant(p:Principal,input:AssistantInput):Promise<AssistantReply>;
declare function prepareAssistantAction(p:Principal,proposalId:string):Promise<Reviewed<AssistantCommand>>;
declare function confirmAssistantAction(p:Principal,input:Confirm<AssistantCommand>):Promise<{entityId:string}>;
declare function searchWorkspace(p:Principal,input:SearchQuery):Promise<Page<SearchHit>>;
```

**HTTP/entrada:** GET/POST /api/assistant com threadId/text/contextRoute; POST /api/assistant/:id/{prepare,confirm,cancel}; GET /api/search?q&kinds&cursor

**Regra executável:** Painellateral contextual usaLLM central e leiturasautorizadas; allowlist fechada de 4 comandosligada aos serviçosplanning/prospecting/reply. OutputLLM passaZod; mutação somente revisão/confirm real, semshell/SQL/fetch arbitrário. Busca contatos/listas/cadências/execuções/conversascom paginação e permissão. Checklist usa fatosobjetivos paraetapasoperacionais e marcaçõesexplícitas paraaprendizado, tours/destinos reais; helpmanifest local e conteúdospróprios. create-audience-automation chama preparePlanningSelection/confirmPlanningSelection do 04 para criar lista+automações pausadas, com agenda/limite/contexto na revisão. Perguntar por leads semanais não ativa execução nem canal; ativar usa o comando de domínio próprio autorizado com nova revisão. Pedido de configurar conta retorna etapas e links reais, sem fabricar integração.

**UI:** `shell:assistant`, `shell:search`, `/first-steps`, `/settings/context`, `ajudas por rota`. Geometria lateral/estadoschat eCtrlK fiéis à referência; cardsde proposta têm rever/cancelar/confirmar e linksreais. Mobile/foco/escape, sem execução oculta.

**Gate externo/aceite:** Solicitação de ação não implementada recebe explicação e destino real, não sucesso fictício. Novos comandos só entram com contrato e teste do domínio.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-06f-assistant-experience.md).

## Falhas, operação e critérios de pronto

Revalidar sessão/associação/política antes e depois de I/O. Não repetir efeito incerto; manter receipt e encaminhar à reconciliação. Cache, paginação e locks incluem workspace. Cada pacote deve passar caso feliz, bloqueio, falha/recuperação, permissão/isolamento e comparação visual no estado/viewport declarado, com evidência de execução real ou controlada separada.

Fora deescopo: funcionalidades não listadas no PRD, rebranding próprio, copiar backend privado não observado ou vender integração sem aceite. Parâmetros de fornecedor/implantação ficam nos gates; mudança de alternativa registra impacto e equivalência sem reabrir o produto inteiro.
