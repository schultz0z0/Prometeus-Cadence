# Agente SDR com objetivo, qualificação obrigatória e Agenda — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Agente SDR passa a ter um objetivo (reuniões, venda direta ou qualificar e passar). Ele só age depois de qualificar, marca reuniões com horários reais da Google Agenda (convite e Meet) e mantém a ficha do lead, que é ligada ou criada sozinha.

**Architecture:** O app guarda por conversa a etapa, as respostas do script, as tentativas, a oferta e as divergências de contato, em `sdr_thread_state`, e decide quando a IA pode oferecer. O worker carrega os horários da Agenda antes de chamar o modelo, confere o rascunho (horário fora da lista, link errado) e grava o progresso e a ficha do lead numa única função SQL. A aprovação de uma confirmação de reunião cria o evento antes de enfileirar a mensagem.

**Tech Stack:** Next.js 16, TypeScript (`--experimental-strip-types`), Postgres 18 com RLS forçada e funções SECURITY DEFINER, zod, Google Calendar API v3, Gemini via `runConventionalJson`.

**Spec:** `docs/superpowers/specs/2026-11-16-sdr-objectives-design.md`

## Global Constraints

- Só o Agente SDR muda. Os agentes de Prospecção, LinkedIn e Assistente, e os goldens deles em `tests/fixtures/ai-golden/`, não mudam.
- Fluxo nativo, sem LangGraph. Até 3 chamadas de modelo por turno, orçamento de saída de 4.096 ou 8.192 tokens (a resposta usa 8.192).
- `objective` ∈ `meetings` | `direct-sale` | `qualify-handoff`. Padrão `qualify-handoff`.
- Venda direta: `closingMethod` (rótulo, 1–80 caracteres) e `closingLink` (URL `https://`, até 500 caracteres).
- Oferta de reunião: até 6 horários, de pelo menos 2 dias quando houver. O texto ao lead traz 2 ou 3 deles.
- Obrigatória sem resposta: passagem para o time depois de 2 tentativas no mesmo campo, ou quando o lead se recusa.
- Ficha do lead: só preenche campos vazios. Valor diferente vira divergência, e a pessoa aplica.
- Confirmação: fuso da agenda por extenso (`America/Sao_Paulo` → "horário de Brasília").
- Evento: convida o e-mail do lead quando houver, com `sendUpdates=all`, `conferenceDataVersion=1` e `conferenceData.createRequest` (Meet).
- Modo sem aprovação (`bounded-auto`) continua bloqueado. Não liberar.
- Toda a interface em português do Brasil. O app não mostra nome de arquivo nem fonte no texto ao lead.
- Migrações novas a partir de `124-`, em LF.

## Review Focus

1. **Lead responde a oferta depois que o horário foi ocupado.** Esperado: a aprovação recusa a reserva, nada é enviado, e o próximo turno oferece outros horários. Teste na Task 6: `approval of a meeting whose slot was taken books nothing and sends nothing`.
2. **Número salvo de jeitos diferentes** (`21964342764`, `+55 21 96434-2764`, `5521964342764`). Esperado: os três ligam à mesma conversa `+5521964342764`. Teste na Task 4: `the lead is linked whatever way its phone was typed`.
3. **Dois leads com o mesmo número.** Esperado: nada é ligado nem criado, e a conversa pede escolha. Teste na Task 4: `two leads with the same phone link nothing`.
4. **Rascunho editado na aprovação apaga a data.** Esperado: a aprovação recusa com aviso e não cria evento. Teste na Task 6: `an edited confirmation without the booked date is refused`.
5. **Agente sem pergunta obrigatória.** Esperado: começa já em `qualified` e oferece no primeiro turno. Teste na Task 2: `an agent with no required question starts qualified`.

---

### Task 1: Objetivo na configuração e bloqueios de ativação

**Files:**
- Modify: `src/domain/sdr-policy.ts` (schema, defaults, `SdrFacts`, `sdrBlockers`)
- Modify: `src/server/sdr/configuration.ts` (preencher `facts.calendar` em `prepareSdrActivation` e `readSdr`)
- Test: `tests/07b1-sdr-configuration.test.ts`

**Interfaces:**
- Produces: `sdrDraftSchema` ganha `objective:'meetings'|'direct-sale'|'qualify-handoff'` (`.default('qualify-handoff')`) e `closing:{method:string;link:string}` (`.default({method:'',link:''})`). `SdrFacts` ganha `calendar:{ready:boolean;summary:string|null}`. `SdrDraft` é exportado como antes.

- [ ] **Step 1: Testes que falham**

```ts
test('objective defaults to qualify-handoff and old drafts still parse',()=>{
 const old={...defaultSdrDraft()} as any;delete old.objective;delete old.closing;
 assert.equal(sdrDraftSchema.parse(old).objective,'qualify-handoff');
});
test('meetings needs a ready calendar and direct sale needs an https link',()=>{
 const f={...readyFacts,calendar:{ready:false,summary:null}};
 assert.ok(sdrBlockers({...readyDraft,objective:'meetings'},f).includes('Conecte a Google Agenda em Configurações → CRM e apps para o agente marcar reuniões.'));
 assert.ok(sdrBlockers({...readyDraft,objective:'direct-sale',closing:{method:'checkout',link:'http://x.com'}},f).includes('Informe o link de fechamento (https://) e como a venda é fechada.'));
 assert.deepEqual(sdrBlockers({...readyDraft,objective:'meetings'},{...f,calendar:{ready:true,summary:'seg–sex 9h–18h · 30 min'}}),[]);
});
```

`readyDraft` e `readyFacts` são os objetos válidos que o arquivo de teste já usa (adicione `calendar:{ready:true,summary:null}` a `readyFacts`).

- [ ] **Step 2:** `node --experimental-strip-types --test tests/07b1-sdr-configuration.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** Implemente o schema e os dois bloqueios com os textos exatos dos testes. Em `configuration.ts`, `calendar.ready` = `app.calendar_access()` com estado `ready`, `config` salvo e sem atenção. `summary` é montado com dias, horário e duração.
- [ ] **Step 4:** Rode o teste do Step 2, `node scripts/test-integration.mjs 07b1-sdr-configuration` e `npm test`. Esperado: tudo PASS.
- [ ] **Step 5:** Commit: `feat(sdr): agent objective and its activation blockers`.

### Task 2: Etapas, oferta e conferências (domínio puro)

**Files:**
- Create: `src/domain/sdr-stage.ts`
- Test: `tests/sdr-stage.test.ts`

**Interfaces:**
- Produces:
  - `type SdrStage='qualifying'|'qualified'|'offer'|'done'`
  - `type SdrAnswers=Record<string,{value:string;messageId:string}>`
  - `interface SdrProgress{stage:SdrStage;answers:SdrAnswers;attempts:Record<string,number>;asked:string|null;offer:SdrOffer|null}`
  - `type SdrOffer={kind:'meeting';slots:{id:string;start:string;end:string;label:string}[];timezone:string}|{kind:'sale';linkSentAt:string|null}`
  - `startProgress(draft:SdrDraft):SdrProgress`: `qualified` se não houver obrigatória.
  - `nextRequired(draft:SdrDraft,answers:SdrAnswers):string|null`
  - `advance(draft:SdrDraft,p:SdrProgress,turn:{fields:{field:string;value:string;messageId:string}[];refused:boolean;leadIds:Set<string>}):{progress:SdrProgress;handoff:string|null}`: aceita só campo do script cujo `messageId` está em `leadIds`. Soma tentativa em `asked` sem resposta. Com 2 tentativas ou recusa, `handoff`=`'não respondeu a pergunta obrigatória: '+question`.
  - `pickOfferSlots(slots:{start:string;end:string}[],timezone:string,max=6):SdrOffer&{kind:'meeting'}`: ids `s1..s6`, de pelo menos 2 dias quando houver, `label` como `'terça, 17/11 às 10:00'`.
  - `timezoneLabel(tz:string):string`: `America/Sao_Paulo`→`horário de Brasília`. Outros fusos devolvem o próprio nome.
  - `unlistedTimes(reply:string,offer:{label:string}[]):string[]`: horas (`10h`, `10:00`, `10h30`) que não aparecem em nenhum `label`.
  - `saleLinkProblem(reply:string,link:string):string|null`: `null` se a resposta contém o link exato e nenhuma outra URL.

- [ ] **Step 1: Testes que falham** em `tests/sdr-stage.test.ts`:
  - `an agent with no required question starts qualified`: `startProgress({...d,qualification:[{question:'Porte?',field:'porte',required:false}]}).stage==='qualified'`.
  - `a required answer counts only when it points to a lead message`: um campo com `messageId` fora de `leadIds` não entra em `answers` e a etapa continua `qualifying`. Com o `messageId` em `leadIds`, entra e vai para `qualified`.
  - `two unanswered asks or a refusal hand off`: duas chamadas a `advance` sem o campo, com `asked:'porte'`, terminam com `handoff` `'não respondeu a pergunta obrigatória: Porte?'`. A recusa (`refused:true`) passa já na primeira.
  - `offer slots span at least two days and carry readable labels`: 10 horários em 3 dias viram 6 ids `s1..s6` com pelo menos 2 datas distintas, e o primeiro label é `'segunda, 16/11 às 09:00'` para `2026-11-16T12:00:00Z` em `America/Sao_Paulo`.
  - `unlisted times are caught`: `unlistedTimes('Pode ser 10h ou 15h?',[{label:'segunda, 16/11 às 10:00'}])` devolve `['15h']`.
  - `the sale link must be the configured one and the only one`: `null` para o link exato. Mensagem de problema para link ausente ou com URL extra.
- [ ] **Step 2:** `node --experimental-strip-types --test tests/sdr-stage.test.ts`. Esperado: FAIL (módulo inexistente).
- [ ] **Step 3:** Implemente `src/domain/sdr-stage.ts` com as assinaturas acima, usando `Intl.DateTimeFormat('pt-BR',{timeZone})` para os rótulos.
- [ ] **Step 4:** Rode de novo e depois `npm test`. Esperado: PASS.
- [ ] **Step 5:** Commit: `feat(sdr): conversation stages, offer slots and draft checks`.

### Task 3: Saída do modelo e regras por objetivo

**Files:**
- Modify: `src/domain/sdr-turn.ts` (`SdrOutput`, schema zod, `sdrOutputJsonSchema`, `sdrPrompt`, `sdrProposal`)
- Modify: `tests/sdr-compose.test.ts`, `tests/ai-golden.test.ts` (o golden `sdr-turn` é regenerado de propósito, os demais não)

**Interfaces:**
- Consumes: `SdrProgress`, `SdrOffer`, `timezoneLabel` (Task 2).
- Produces:
  - `SdrOutput` ganha `contact:{name:string;email:string;phone:string;company:string;messageId:string}|null`, `profile:{pain:string;plan:string;nextStep:string}`, `offered:string[]` (ids da oferta), `chosen:string|null`, `preference:string|null` e `refused:boolean`, com defaults seguros no parse.
  - `sdrPrompt` aceita `objective`, `closing`, `progress:SdrProgress` e `offer` e manda as regras de etapa:
    - em `qualifying`, pede só `nextRequired` e proíbe oferta, link e passagem por objetivo;
    - em `offer`, oferece 2 ou 3 da lista;
    - na confirmação, informa dia, data, hora, `timezoneLabel`, duração e "online pelo Google Meet".
  - Inclui o roteiro curto de técnica de vendas.
  - `SdrProposal` ganha `{kind:'meeting';slot:{id;start;end;label};timezone:string}`. A antiga `calendar-options` continua aceita na leitura, para turnos antigos.

- [ ] **Step 1: Testes que falham** em `tests/sdr-compose.test.ts`:
  - `the qualifying prompt asks only the next required question and forbids the objective action`: o prompt com `progress.stage='qualifying'` contém `'Pergunte agora: Porte?'` e `'Ainda não ofereça reunião, link ou passagem.'`.
  - `the offer prompt lists only the app slots`: com uma oferta de 3 horários, `JSON.parse(prompt).offer.slots.map(s=>s.id)` é `['s1','s2','s3']`.
  - `parse keeps new fields with safe defaults`: o parse de uma saída antiga dá `contact` `null`, `offered` `[]`, `chosen` `null` e `refused` `false`.
- [ ] **Step 2:** `node --experimental-strip-types --test tests/sdr-compose.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** Implemente. As frases exatas dos testes entram na lista `instructions`.
- [ ] **Step 4:** Regenere só o golden do SDR (`rm tests/fixtures/ai-golden/sdr-turn.json` e depois `UPDATE_GOLDEN=1 node --experimental-strip-types --test tests/ai-golden.test.ts`). Confira com `git diff --stat tests/fixtures` que só `sdr-turn.json` mudou. Rode `npm test`. Esperado: PASS.
- [ ] **Step 5:** Commit: `feat(sdr): objective-aware prompt and output`.

### Task 4: Banco de dados — etapa, ficha do lead, ligação automática e Agenda no worker

**Files:**
- Create: `db/migrations/124-sdr-objectives.sql`
- Test: `tests/integration/sdr-objectives.test.ts` (novo; registrar em `scripts/test-integration.mjs` se a lista for explícita)

**Interfaces:**
- Produces (SQL):
  - Colunas em `sdr_thread_state`: `stage text NOT NULL DEFAULT 'qualifying'` (CHECK nos 4 valores), `answers jsonb NOT NULL DEFAULT '{}'`, `attempts jsonb NOT NULL DEFAULT '{}'`, `asked text`, `offer jsonb`, `conflicts jsonb NOT NULL DEFAULT '[]'`.
  - `app.lead_phone_e164(text) RETURNS text IMMUTABLE`: mesma regra de `leadWhatsappPhone` (`src/domain/whatsapp-identity.ts`).
  - `app.sdr_ensure_lead(p_ws text,p_conversation text) RETURNS jsonb` → `{leadId,mode:'linked'|'created'|'ambiguous'|'existing'}`. Em `created`, usa a lista "Agente SDR" do workspace (cria se não existir), com `payload` `{name:<pushName ou telefone>,phone:<e164>,source:'sdr',createdBy:'sdr'}`. Grava `lead_link_evidence` `{actorId:'sdr',evidence:'mesmo número de WhatsApp'}`.
  - `app.sdr_turn_payload` ganha `progress` (as colunas acima), `objective`, `closing`, `leadId` e `calendarReady`.
  - `app.sdr_finish_turn(...11 args..., p_progress jsonb)`, com 12 argumentos, envolve a versão de 11:
    - só quando o turno vira `pending-approval`, `handed-off` ou `abstained`, grava `stage`, `answers`, `attempts`, `asked` e `offer`;
    - com `p_progress->'contact'` e lead ligado, preenche só os campos vazios (`email`, `phone`, `companyName`) e põe os diferentes em `conflicts`;
    - grava `payload.sdrProfile` = `{personName,pain,info,plan,nextStep,status,updatedAt}`.
  - `app.sdr_apply_conflict(p_conversation text,p_field text) RETURNS void` (app, `messages.reply`): aplica a divergência na ficha e a remove de `conflicts`.
  - `app.worker_calendar_access(p_ws text) RETURNS jsonb` e `app.worker_save_calendar_tokens(p_ws,p_connection,p_revision,p_secret,p_expires)`, só para `cadence_worker`, no mesmo formato de `calendar_access`/`save_calendar_tokens` (`db/migrations/099-google-calendar.sql`).

- [ ] **Step 1: Testes que falham** em `tests/integration/sdr-objectives.test.ts`, com o fixture de `tests/integration/07b2-sdr-conversation.test.ts` (copie `fixture`/`inbound`):
  - `the lead is linked whatever way its phone was typed`: para cada `['21964342764','+55 21 96434-2764','5521964342764']`, um lead com esse `phone` e uma conversa `+5521964342764` resultam em `mode:'linked'` e `channel_conversation.lead_id` igual ao lead.
  - `an unknown number gets a new lead in the Agente SDR list`: `mode:'created'`, lista com nome `'Agente SDR'` e `payload.source==='sdr'`.
  - `two leads with the same phone link nothing`: `mode:'ambiguous'` e `lead_id` nulo.
  - `finishing a turn fills only empty lead fields and keeps conflicts`: o lead tem `email` `'a@x.com'`. Com o contato `{email:'b@x.com',company:'Nexus'}`, a ficha fica com `email` `'a@x.com'` e `companyName` `'Nexus'`, e `conflicts` traz `[{field:'email',value:'b@x.com'}]`. Depois de `sdr_apply_conflict`, a ficha tem `'b@x.com'` e `conflicts` fica vazio.
  - `progress is not written by a lost or superseded turn`: com o turno `superseded`, `stage` continua `'qualifying'`.
- [ ] **Step 2:** `node scripts/test-integration.mjs sdr-objectives`. Esperado: FAIL.
- [ ] **Step 3:** Escreva a migração. Os grants seguem o padrão de `122-sdr-memory-sources.sql`: REVOKE de PUBLIC, depois GRANT ao papel certo.
- [ ] **Step 4:** Rode o Step 2 e as suítes `07b2-sdr-conversation` e `07b3-sdr-actions`. Esperado: PASS.
- [ ] **Step 5:** Commit: `feat(sdr): stage state, lead record updates and automatic lead link`.

### Task 5: Worker e composição com etapas e Agenda

**Files:**
- Modify: `src/server/sdr/worker.ts`, `src/server/sdr/compose.ts`, `src/server/sdr/configuration.ts` (simulação)
- Create: `src/server/integrations/calendar-worker.ts`
- Test: `tests/sdr-compose.test.ts`, `tests/integration/sdr-objectives.test.ts`

**Interfaces:**
- Consumes: Tasks 2 a 4. Também `openTokens`, `sealTokens` e `withAccess` de `src/server/integrations/google.ts`, e `candidateSlots`/`freeSlots` de `src/domain/connector-capabilities.ts`.
- Produces:
  - `readWorkerSlots(workspaceId:string,range:{from:number;to:number},deps:GoogleDeps):Promise<{timezone:string;durationMinutes:number;slots:{start:string;end:string}[]}>` em `calendar-worker.ts`. É o mesmo cálculo de `readCalendarSlots`, com os tokens de `worker_calendar_access`.
  - `ComposeInput` ganha `objective`, `closing`, `progress`, `offer`, `leadIds`.
  - `ComposeResult` ganha `progress:SdrProgress`, `handoff:string|null`, `contact` e `profile`.
  - `composeSdrReply`:
    - roda `advance`;
    - em `qualified` com `meetings`, pede `slots` ao chamador (via `deps.slots`) e entra em `offer`;
    - confere o rascunho com `unlistedTimes`/`saleLinkProblem` e, se der problema, chama o modelo de novo dentro do limite de 3. Sem chamada sobrando, `decision='abstain'` com motivo `'SDR_DRAFT_CHECK'`;
    - com `chosen` válido, devolve a proposta `{kind:'meeting',slot,timezone}`;
    - com `preference`, pede novos horários e oferece de novo.
  - `runSdrTick`: antes de compor, chama `app.sdr_ensure_lead`. Passa `deps.slots=(range)=>readWorkerSlots(...)`. Grava `p_progress` (progresso, contato, perfil).
  - `SdrWorkerDeps` ganha `slots?`.
  - Objetivos ao chegar em `qualified`:
    - `qualify-handoff`: `decision='handoff'` com o motivo `'Lead qualificado'`, e o resumo (`summary`) vai na notificação de passagem;
    - `direct-sale`: o rascunho com o link aprovado na conferência leva a etapa a `done` (`offer={kind:'sale',linkSentAt}`).
  - `simulateSdr` (`src/server/sdr/configuration.ts`) usa `startProgress(draft)` e um `slots` lido com o Principal (`readCalendarSlots`), e devolve a etapa na resposta da simulação.

- [ ] **Step 1: Testes que falham:**
  - Unidade (`sdr-compose.test.ts`): `an off-list time is asked again and then abstains`. O `generate` falso sempre devolve `'Pode ser 15h?'` com uma oferta só de 10:00. Esperado: 3 chamadas, `out.decision==='abstain'` e motivo `'SDR_DRAFT_CHECK'`.
  - Unidade: `a chosen slot becomes a meeting proposal`. Com `chosen:'s2'`, `r.out.proposal` é `{kind:'meeting',slot:{id:'s2',...},timezone:'America/Sao_Paulo'}`.
  - Unidade: `qualifying never offers`. Com `progress.stage='qualifying'` e a obrigatória sem resposta, `deps.slots` nunca é chamado.
  - Integração: `a qualified meetings agent offers real slots`. Agente `meetings`, script sem obrigatória e `slots` falso com 8 horários. Esperado: o turno fica `pending-approval`, `sdr_thread_state.stage='offer'` e `offer.slots` com 6 itens.
- [ ] **Step 2:** Rode `node --experimental-strip-types --test tests/sdr-compose.test.ts` e `node scripts/test-integration.mjs sdr-objectives`. Esperado: FAIL.
- [ ] **Step 3:** Implemente. A busca nos documentos só roda nas etapas `offer`/confirmação se `shouldPlanSearch` e a mensagem tiver `?`.
- [ ] **Step 4:** Rode os mesmos comandos, mais `07b2-sdr-conversation`, `07b3-sdr-actions` e `npm test`. Esperado: PASS.
- [ ] **Step 5:** Commit: `feat(sdr): stage-driven turns with real calendar offers`.

### Task 6: Aprovar a confirmação cria a reunião (convite e Meet)

**Files:**
- Modify: `src/server/integrations/calendar.ts` (`reserveCalendarSlot` aceita `attendeeEmail?:string`; corpo do evento; guarda `meetUrl`)
- Modify: `src/server/sdr/business-actions.ts` (nova `bookSdrProposal`), `src/server/sdr/conversation.ts` (`approveSdrReply`)
- Create: `db/migrations/125-sdr-meeting-link.sql` (`calendar_reservation.meet_url text`; `sdr_booking_view` passa a devolver `meetUrl`)
- Test: `tests/integration/sdr-objectives.test.ts`, `tests/integration/07b3-sdr-actions.test.ts`

**Interfaces:**
- Consumes: a proposta `{kind:'meeting',slot,timezone}` (Task 5) e `sdr_booking_begin` e `reserveCalendarSlot`, que já existem.
- Produces: `bookSdrProposal(p:Principal,conversationId:string,turnId:string,requestId:string,deps?:CalendarDeps):Promise<{start:string;end:string;meetUrl:string|null}>`. Ela:
  - acha o horário com `readCalendarSlots(p,{from:slot.start,to:slot.end})`, pelo `start` exato;
  - recusa com `409 'Este horário acabou de ser ocupado. O agente vai oferecer outros.'` se não achar;
  - usa como `attendeeEmail` o e-mail da ficha do lead;
  - reserva.

  `approveSdrReply`: se o turno tem a proposta `meeting`, chama `bookSdrProposal` **antes** de `confirmReply`. Recusa o texto editado que não contém a data `dd/mm` e a hora `HH:MM` da reserva (`422 'O texto não traz mais a data e a hora da reunião marcada. Revise antes de aprovar.'`). Acrescenta `\nLink da reunião: <meetUrl>` quando houver. Se `confirmReply` falhar depois do evento criado, a conversa fica com o aviso `'Reunião marcada, confirmação não entregue.'` (`sdr_notify` ao responsável).

- [ ] **Step 1: Testes que falham** (Google simulado pelo `fetch` dos testes de `07b3`):
  - `approving a meeting creates the event before queuing the message`: a ordem das chamadas registra o `POST /events` antes da linha em `message_outbox`. A URL do evento tem `sendUpdates=all&conferenceDataVersion=1`, o corpo tem `attendees[0].email` igual ao e-mail da ficha e `conferenceData.createRequest`. O texto enviado termina com `Link da reunião: https://meet.google.com/abc`.
  - `approval of a meeting whose slot was taken books nothing and sends nothing`: o freebusy simulado ocupa o horário. Esperado: 409, zero eventos e zero mensagens.
  - `an edited confirmation without the booked date is refused`: com o texto `'Combinado!'`, 422 e nenhum evento.
  - `without a lead e-mail the meeting is booked with no attendees`: o corpo não tem `attendees`.
  - `a booked meeting closes the stage and a cancelled one reopens it`: depois da aprovação, `stage='done'`. Depois de `cancelSdrBooking`, `stage='qualified'` e `offer` nulo. Isso exige atualizar o estado em `bookSdrProposal` e em `cancelSdrBooking`.
- [ ] **Step 2:** `node scripts/test-integration.mjs sdr-objectives`. Esperado: FAIL.
- [ ] **Step 3:** Implemente. Mantenha a proteção contra reserva dupla ou incerta que já existe. `meetUrl` sai de `hangoutLink` ou de `conferenceData.entryPoints[type=video].uri` da resposta.
- [ ] **Step 4:** Rode o Step 2, `07b3-sdr-actions` e `npm test`. Esperado: PASS.
- [ ] **Step 5:** Commit: `feat(sdr): approving a meeting confirmation books it with invite and Meet`.

### Task 7: Telas — objetivo, conversa e ficha do lead

**Files:**
- Modify: `src/modules/sdr/agent-settings.tsx` (bloco "Objetivo": 3 opções; para `meetings`, o resumo da Agenda e o link `/settings/apps/google-calendar`; para `direct-sale`, os campos "Forma de fechamento" e "Link de fechamento"; aviso sem obrigatória)
- Modify: `src/modules/sdr/conversation-controls.tsx` (etapa atual; horários oferecidos; "Escolha o contato" quando `ambiguous`; divergências com "Aplicar na ficha"; selo "ligado pelo agente"/"criado pelo agente")
- Modify: `src/modules/contacts/lead-detail.tsx` e `src/domain/model.ts` (`Lead.sdrProfile?`): seção "Conversa com o Agente SDR", com dor, informações, plano, próximo passo, status, pessoa e data
- Modify: `src/server/sdr/conversation.ts` (a view devolve `stage`, `offer`, `conflicts` e `leadLink`) e a rota `src/server/sdr/http.ts` (`apply-conflict`)

**Interfaces:**
- Consumes: as Tasks 1, 4 e 6.

- [ ] **Step 1:** Teste que falha em `tests/integration/sdr-objectives.test.ts`: `the conversation view shows stage, offer and conflicts`. Esperado: `readSdrConversation(...).stage==='offer'`, `offer.slots.length===6` e `conflicts[0].field==='email'`.
- [ ] **Step 2:** `node scripts/test-integration.mjs sdr-objectives`. Esperado: FAIL.
- [ ] **Step 3:** Implemente a view, a rota e as três telas, seguindo os componentes que já existem (`Notice`, `Badge`, `Button`, `Field`).
- [ ] **Step 4:** Rode o Step 2 e `npm test`. Depois `npm run build`. Esperado: PASS e build sem erro.
- [ ] **Step 5:** Verifique no app (Chrome, build de produção):
  - a tela do agente mostra os 3 objetivos;
  - "Marcar reuniões" sem a Agenda gera o bloqueio;
  - a ficha de um lead com `sdrProfile` mostra a seção.
- [ ] **Step 6:** Commit: `feat(sdr): objective settings, conversation stage and lead SDR section`.

### Task 8: Registro, divergência e regressão completa

**Files:**
- Modify: `AGENTS.md` (parágrafo de divergência: objetivo do SDR, qualificação obrigatória, reuniões com convite e Meet, lead ligado ou criado automaticamente, seção na ficha; a referência mostra "Agenda e registra no CRM" sem comportamento observado)
- Modify: `docs/validation/2026-11-12-homologacao-canais-reais.md` (seção do resultado)

- [ ] **Step 1:** Escreva os dois textos.
- [ ] **Step 2:** `npm test`. Depois `node scripts/test-integration.mjs` com todas as suítes. Esperado: unidade toda PASS. Integração com 0 falhas, e os 5 pulados de antes continuam pulados.
- [ ] **Step 3:** Commit: `docs: SDR objectives divergence and homologation record`.

Depois do merge, na homologação real (fora do plano, com o operador):
1. Configurar o agente Prometeus com `meetings` e perguntas obrigatórias.
2. Fazer uma conversa real até o convite chegar no e-mail do lead.
3. Se o Google recusar criar o Meet com `calendar.events.owned`, registrar o escopo `https://www.googleapis.com/auth/calendar.events` e reconectar a Agenda.
