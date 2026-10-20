# Prometeus Cadence — Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a primeira versão local navegável, visualmente fiel, com estado demonstrativo persistente e fluxos de público → proposta → confirmação → cadência → revisão → rascunho.

**Architecture:** Aplicação Next.js com App Router e módulos de domínio separados das páginas. Um repositório demonstrativo local implementa interfaces que serão substituídas por acesso autenticado ao servidor na entrega 02. Todos os conectores externos aparecem desconectados e toda simulação é identificada como demonstração.

**Tech Stack:** Next.js, React, TypeScript e CSS com tokens; APIs nativas para SVG, diálogos e persistência local; Node `node:test` para regras de domínio. Reaproveitar as capacidades de navegador já disponíveis para verificação de fluxos e imagens. Selecionar versões concretas suportadas e registrar lockfile ao executar; não usar versões móveis no lockfile.

**Spec:** `docs/superpowers/specs/2026-10-20-prometeus-cadence-design.md`, aprovada em 20/10/2026. Roteiro completo em `2026-10-20-prometeus-cadence-roadmap.md`.

## Global Constraints

- “Evitar redesenho criativo na primeira implementação.”
- “Uma interface navegável isolada será um marco intermediário, nunca apresentada como SaaS integral concluído.”
- “Correções humanas prevalecem sobre releituras e ficam versionadas.”
- “Nenhuma geração ativa envios.”
- “Quantidade indisponível aparece como desconhecida; não fabricar contagens.”
- Claro: primária `#FF6B00`, fundo `#FAFAFA`, texto `#111827`, superfície `#FFFFFF`, borda `#E5E7EB`.
- Escuro: primária `#FF8533`, fundo `#0C0E12`, texto `#F9FAFB`, superfície `#161A22`, borda `#2D323B`.
- Fontes Sora/Manrope/JetBrains Mono; raios 6/8/12/16px; sidebar recolhível e IA por etapas.
- Referências somente de `docs/reverse-engineering/`; não reutilizar bundles de terceiros como código do novo produto.
- Não enviar mensagens, conectar contas, ativar cobrança ou consumir créditos externos no marco 01.
- Não criar skills, plugins ou MCPs; consulta O Setup pendente por 401 não equivale a ausência de recurso.
- Comandos de shell com prefixo `rtk`. Preservar arquivos existentes e evidências locais.

## Review Focus

1. Refresh no meio da revisão: rascunho confirmado persiste; proposta ainda não confirmada não cria entidades (T2/T6/T7).
2. Clique duplo em confirmar: exatamente uma lista e duas automações, com vínculo correto (T2/T6).
3. Entrada sem site/telefone e nomes longos: layout continua legível e não inventa informações (T3/T4).
4. Variável de mensagem sem valor: aviso explícito na prévia; não substituição silenciosa com dado inventado (T7).
5. Storage corrompido ou versão incompatível: erro recuperável e opção de restaurar demonstração, sem crash silencioso (T2).

## Estrutura prevista

```text
src/app/layout.tsx, globals.css
src/app/(app)/layout.tsx
src/app/(app)/dashboard/page.tsx
src/app/(app)/contacts/page.tsx
src/app/(app)/leads/[id]/page.tsx
src/app/(app)/leads/{generator,qualifier,enrich}/page.tsx
src/app/(app)/automations/page.tsx
src/app/(app)/automations/new/page.tsx
src/app/(app)/automations/new/ai/page.tsx
src/app/(app)/cadences/page.tsx
src/app/(app)/cadences/[id]/page.tsx
src/app/(app)/cadences/new/ai/page.tsx
src/app/(app)/cadences/pipeline/page.tsx
src/app/(app)/templates/page.tsx
src/app/(app)/executions/page.tsx
src/app/(app)/inbox/page.tsx
src/app/(app)/messages/whatsapp/page.tsx
src/app/(app)/reports/page.tsx
src/app/(app)/settings/[[...section]]/page.tsx
src/app/(app)/linkedin/[[...section]]/page.tsx
src/app/(app)/sdr/page.tsx
src/app/(app)/first-steps/page.tsx
src/components/{shell,ui,charts,onboarding}/
src/modules/{dashboard,contacts,prospecting,automations,cadences,messages,settings}/
src/domain/{model,repository,automation,cadence,metrics}.ts
src/demo/{seed,repository,provider,storage}.ts
tests/{repository,automation,cadence,metrics}.test.ts
docs/validation/01-interface.md
```

Páginas contêm composição; estado e regras ficam nos módulos/domínio. Não criar um único componente de milhares de linhas. Rotas somente inventariadas podem ter estado de requisito/desconectado que explica a próxima ação; não fingir módulo funcional com link vazio.

### T1 — Shell fiel e navegação

**Files:** criar `package.json`, `package-lock.json`, configuração Next/TypeScript, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/(app)/layout.tsx`, `src/components/shell/{app-shell,sidebar,topbar}.tsx`, `src/components/ui/{button,dialog,field,badge,empty-state}.tsx`.

**Interfaces:** `AppShell({children}: {children: React.ReactNode})`; `Sidebar` usa catálogo único `NavigationItem {label,href?,children?,requires?}` em `src/components/shell/navigation.ts`; sem acesso externo.

- [ ] Criar configuração mínima no diretório existente, sem executar scaffold que sobrescreva os documentos. Configurar scripts `dev`, `build`, `start`, `typecheck`, `test`.
- [ ] Implementar tokens, fontes, sidebar na ordem observada, header e faixa de demonstração explicativa. Texto da marca: Prometeus Cadence.
- [ ] Implementar expandir/recolher, grupos, breadcrumbs, tema, três tamanhos de texto e busca por páginas, com atalhos de teclado e foco visível.
- [ ] Rodar `rtk npm run build` e `rtk npm run typecheck`; abrir shell em 1920/1440/1280/390px. Conferir ausência de rolagem horizontal acidental e navegação por teclado.
- [ ] Commit somente dos arquivos desta tarefa: `feat: add cadence application shell`.

### T2 — Domínio e repositório de demonstração

**Files:** criar `src/domain/{model,repository,automation}.ts`, `src/demo/{seed,repository,storage,provider}.ts(x)`, `tests/{repository,automation}.test.ts`; modificar layout app para provider.

**Interfaces:** `Lead {id,listId,name,companyName?,email?,phone?,site?,city?,state?,qualification:'qualified'|'pending'|'warning'|'disqualified',reason?,source}`; `LeadList {id,name}`; `Automation {id,name,listId,source,status:'draft'|'paused'|'active'|'error',schedule}`; `Cadence {id,name,listId,status:'draft'|'paused'|'active'|'completed',steps:CadenceStep[],settings:CadenceSettings}`. Definir os tipos completos consumidos por T6/T7 neste arquivo, incluindo propostas e preferências.

Produz `DemoRepository`: `getSnapshot(): DemoState`; `subscribe(listener:()=>void):()=>void`; `upsertLead(lead:Lead):void`; `confirmAutomationPlan(plan:AudiencePlan,requestId:string):{listId:string,automationIds:[string,string]}`; `saveCadenceDraft(cadence:Cadence):void`; `saveContext(profile:CompanyProfile):void`; `reset():void`. `DemoState {schemaVersion:1,lists,leads,automations,cadences,templates,companyProfile,preferences,confirmationResults}`. `decodeDemoState(raw:string|null):{ok:true,value:DemoState}|{ok:false,reason:string}`.

- [ ] Escrever testes: state roundtrip mantém IDs e drafts; JSON inválido retorna `ok:false`; versão 99 é rejeitada; duas confirmações com mesmo requestId retornam os mesmos IDs e total de 1 lista/2 automações; salvar rascunho mantém `status:'draft'`.
- [ ] Rodar `rtk npm test` antes da implementação e confirmar falha pelo módulo ausente; registrar o resultado.
- [ ] Implementar seed com empresas fictícias, listas e cadência inicial; snapshot imutável, persistência local versionada, recuperação visível e idempotência. Chave local `prometeus-cadence-demo-v1`; acesso a storage somente no cliente. Não armazenar contatos da conta original.
- [ ] Rodar `rtk npm test` e `rtk npm run typecheck`; confirmar que SSR/hidratação não lê localStorage no servidor.
- [ ] Commit: `feat: add persistent demo domain and approval transactions`.

### T3 — Dashboard, métricas e onboarding

**Files:** criar `src/domain/metrics.ts`, `src/modules/dashboard/dashboard.tsx`, `src/app/(app)/dashboard/page.tsx`, `src/components/charts/{line-chart,funnel}.tsx`, `src/components/onboarding/{checklist,tour}.tsx`, `src/app/(app)/first-steps/page.tsx`, `tests/metrics.test.ts`.

**Interfaces:** consome `DemoRepository.getSnapshot`; produz `calculateMetrics(state:DemoState):DashboardMetrics`, sempre derivando contagens do mesmo conjunto. `TourStep {id,title,body,target?,route?}` com abrir/fechar/voltar/próximo; sem mutações de leads.

- [ ] Escrever teste com 3 leads (2 qualified/1 pending): cartão e funil retornam os mesmos 2 qualificados; e-mail ausente não lança erro. Rodar teste e confirmar falha antes da função.
- [ ] Implementar seis cartões, resumo Hoje, períodos, gráficos SVG, funil e listas de atividade conforme referência; distinguir não medido de zero.
- [ ] Implementar onboarding de seis etapas e passeio contextual; estado demonstrativo de conexão explica o requisito sem alterar dados operacionais.
- [ ] Rodar testes e build; verificar capturas do dashboard sem overlay e do passeio. Corrigir textos longos/ausentes e contraste.
- [ ] Commit: `feat: add dashboard and guided onboarding`.

### T4 — Contatos, perfil e templates

**Files:** criar `src/modules/contacts/{contacts-table,lead-detail,lead-dialog,import-preview}.tsx`, páginas `/contacts` e `/leads/[id]`, `src/modules/cadences/template-library.tsx`, página `/templates`.

**Interfaces:** consome `Lead`, `LeadList`, repositório e snapshot. `Template {id,name,channel:'EMAIL'|'WHATSAPP',tags:string[],subject?,body}` em `model.ts`; `filterLeads(leads:Lead[],query:LeadQuery):Lead[]` em `src/domain/leads.ts`; `parseContactImport(text:string):ImportPreview` em `src/domain/import.ts`.

- [ ] Escrever testes de importação: cabeçalhos mapeados, linha com campo entre aspas/vírgula, contato sem telefone e erro com número da linha em CSV malformado; escrever teste de filtro por status e texto longo. Rodar RED.
- [ ] Implementar filtros, listas, colunas, seleção, ordenação, ficha, cadastro local e preview CSV/TXT com mapeamento. Nenhuma importação grava antes do botão final.
- [ ] Implementar biblioteca de templates, tags, variáveis e prévia; CRUD local com confirmação de exclusão recuperável no demonstrativo.
- [ ] Rodar testes específicos e conferir fluxo no Chrome: incluir fictício → filtrar → abrir → editar → refresh → persistência; importar/cancelar não altera contatos.
- [ ] Commit: `feat: add lead management and template library`.

### T5 — Gerador, qualificador e enriquecimento

**Files:** criar páginas `/leads/generator`, `/leads/qualifier`, `/leads/enrich`; módulos `src/modules/prospecting/{generator,cnpj-filters,qualifier,enrichment}.tsx`; `src/demo/prospecting.ts`.

**Interfaces:** `ProspectingRequest {source:'MAPS'|'WEB'|'CNPJ'|'APOLLO',destination,filters,limit}` e `QualificationConfig {extractEmails,extractPhones,discoverSite,summary,deepExtraction,validateEmail,validateWhatsapp,registry,qualifyAi,language,limit}` definidos em `model.ts`. `simulateProspecting(request:ProspectingRequest):DemoJobResult` só retorna exemplos identificados, com `demo:true` e `billableUsage:0`.

- [ ] Implementar escolha de fonte e filtros observados, com campo habilitado e validação por fonte; preservar distinção avulso/recorrente.
- [ ] Implementar seleção de lista/leads e módulos de qualificação; enriquecimento mostra preview e teto, sem simular cobrança real.
- [ ] Ações de execução oferecem explicitamente demonstração local; nunca apresentar dados fictícios como extração em tempo real. Estado com provedor ausente mostra configuração exigida.
- [ ] Verificar troca de fontes sem perder campos comuns, validação do formulário, cancelamento sem gravação e resumo/contagem coerentes. Rodar build/typecheck.
- [ ] Commit: `feat: add prospecting and qualification workflows`.

### T6 — Automações por IA e formulário manual

**Files:** criar páginas `/automations`, `/automations/new`, `/automations/new/ai`; módulos `src/modules/automations/{automation-list,creation-modes,manual-wizard,audience-wizard}.tsx`; `src/demo/audience.ts`; ampliar `tests/automation.test.ts`.

**Interfaces:** consome `confirmAutomationPlan` de T2. `suggestDemoAudiences(input:{description:string,channel:'email'|'whatsapp'|'both',profile:CompanyProfile}):AudiencePlan[]` retorna 3 propostas demonstrativas, com `marketSize:null`, fonte, filtros, lista e agenda. `AudiencePlan {id,title,description,listName,source,filters,channel,marketSize:number|null,dailyLimit:number}`. Criar sempre pausada; busca 07:00 e qualificação 08:00 no fuso do workspace; limite demonstrativo 150/dia.

- [ ] Escrever teste: gerar 3 propostas não altera snapshot; marketSize ausente é null; confirmar mantém todas pausadas e agrega em uma transação; segunda confirmação mesmo requestId não duplica. Rodar RED para funções novas.
- [ ] Implementar lista agrupada, busca/filtros, quatro modos, wizard manual de cinco passos e wizard IA de duas etapas. Até a confirmação, alterações ficam no estado do formulário.
- [ ] Implementar resultado com links para lista, busca e criação de cadência. Editar proposta ou voltar não consome quota nem cria entidades.
- [ ] Rodar testes; verificar no navegador público → 3 opções → revisar → criar → refresh → mesma lista/2 automações. Repetir clique rápido e cancelar etapa anterior.
- [ ] Commit: `feat: add approval based automation creation`.

### T7 — Cadência por IA e canvas editável

**Files:** criar páginas `/cadences`, `/cadences/new/ai`, `/cadences/[id]`, `/cadences/pipeline`; módulos `src/modules/cadences/{cadence-list,cadence-wizard,sequence-canvas,step-editor,cadence-settings,pipeline}.tsx`; `src/domain/cadence.ts`, `src/demo/cadence.ts`, `tests/cadence.test.ts`.

**Interfaces:** `CadenceStep {id,channel:'EMAIL'|'WHATSAPP'|'LINKEDIN',delayDays:number,subject?,body:string,aiInstructions?:string,stopOnReply:boolean}`; `CadenceSettings {timezone,weekdays:number[],sendTime:string,skipHolidays,intervalSeconds:[number,number],whatsappIntervalSeconds:[number,number],budgetPercent:number|null,stopOnReply,stopKeywords:string[],bounceLimit:number}`. `validateCadence(cadence:Cadence):ValidationIssue[]`; `renderMessage(template:string,lead:Lead):{text:string,unresolved:string[]}`; `buildDemoCadenceOptions(input:CadenceBrief):Cadence[]` retorna 3 drafts.

- [ ] Escrever testes: `{nome}`/`{{nome}}` segundo sintaxe suportada explicitamente (usar `{{nome}}` no produto); variável `{{cidade}}` sem valor retorna unresolved; intervalo min maior que max inválido; delay negativo inválido; bounce menor que 3 inválido; todas as opções são drafts. Rodar RED.
- [ ] Implementar wizard de 3 etapas com objetivos, contexto, lista/canal/tom/ritmo/destacar/evitar; seleção não salva antes da revisão final.
- [ ] Implementar canvas pontilhado com entrada, waits, etapas, saída, adicionar/editar/reordenar/remover, zoom e minimapa. Prévia não pode sumir com erro de variável; salvar rascunho mantém draft.
- [ ] Implementar abas, configurações observadas e pipeline derivado da mesma cadência. Saúde/Relatório demonstrativos mostram ausência de execução real. Ativar exibe requisito de integração, sem disparar.
- [ ] Rodar testes e build; verificar criação, edição, zoom, refresh, listas relacionadas, teclado e layout 1280px.
- [ ] Commit: `feat: add cadence builder and review flow`.

### T8 — Mensagens, configurações e superfícies restantes

**Files:** criar páginas `/inbox`, `/messages/whatsapp`, `/executions`, `/reports`, `/settings/[[...section]]`, `/linkedin/[[...section]]`, `/sdr`; módulos `src/modules/messages/{inbox,channel-empty-state}.tsx`, `src/modules/settings/{settings-layout,account,context,channels,plan,integrations}.tsx` e `src/modules/reports/reports.tsx`.

**Interfaces:** consome dados/preferências existentes; `CompanyProfile {id,version,domain,name,offer,products,idealCustomer,pains,differentiators,competitors,socialProof,sources,approvedAt:null|string}`; `approveProfile(profile:CompanyProfile,now:string):CompanyProfile` em `src/domain/context.ts` preserva correções humanas. Não acrescentar clients externos neste marco.

- [ ] Implementar menus secundários e formulários de conta/contexto, salvar rascunho/aprovar, canais desconectados, limites, plano/uso, membros/segurança como fluxos locais claramente identificados ou requisitos de serviço.
- [ ] Implementar e-mail recebidos/enviados, filtros e detalhe de conversa demonstrativa; WhatsApp sem número direciona para configurações. Executions e relatórios não inventam entregas.
- [ ] LinkedIn/SDR exibem workflow e requisitos de conexão/ativação; controlar CTAs para não apontar para URL vazia. Informar que o recurso real está pendente de integração.
- [ ] Testar perfil aprovado não sofre substituição de campos corrigidos ao propor releitura demonstrativa. Validar todos os links de navegação e estados vazios; rodar testes/build/typecheck.
- [ ] Commit: `feat: add account channels inbox and reporting surfaces`.

### T9 — Comparação visual e entrega do marco

**Files:** criar `docs/validation/01-interface.md`, capturas próprias em `docs/validation/screenshots/`; ajustar apenas componentes com divergências verificadas; README raiz com instalação e limites reais.

**Interfaces:** nenhuma nova; esta tarefa verifica os contratos e superfícies anteriores.

- [ ] Rodar `rtk npm test`, `rtk npm run typecheck`, `rtk npm run build`; registrar comandos, códigos de saída e resultado, sem alegar teste de integração real.
- [ ] Pelo navegador existente, executar roteiro dashboard → lista → proposta de automação → confirmação → cadência IA → revisão → salvar → refresh. Verificar não duplicação, contexto, vinculação e persistência.
- [ ] Capturar dashboard, contatos, automações, wizard, canvas e canais em desktop; conferir fontes, cor, espaços, densidade e estados contra os prints. Capturar 390px para validar navegação responsiva. Não aceitar baselines novas como prova de igualdade com a referência.
- [ ] Testar armazenamento inválido, ausência de dados, nomes longos, clique duplo e variáveis faltantes. Corrigir divergências materiais e repetir somente os checks afetados.
- [ ] Fazer revisão do conjunto conforme o método escolhido pelo usuário. Relatar o marco 01 e os pendentes 02–08; nunca chamar o demonstrativo de clone funcional integral.
- [ ] Commit: `test: verify interface workflows and visual fidelity`.

## Auto-revisão do plano

- Escopo total: as seções de identidade real, billing, conectores, scheduler, SDR e LinkedIn conectado estão no roteiro 02–08; não são critérios falsamente atendidos pelo marco 01.
- Interfaces: T2 define o modelo e repositório; T6/T7 usam os mesmos nomes e estados. Tipos detalhados são formalizados antes de seus consumidores.
- Cinco riscos do Review Focus têm verificação em T2/T3/T4/T6/T7/T9.
- As capturas dos tutoriais contêm overlays; comparar o estado correto, não tentar igualar uma tela sem passeio a um print com overlay.
- Nenhuma etapa requer cartão, chave ou tráfego do concorrente. Novas instalações do produto só começam após a revisão deste plano.

## Handoff

Plano escrito; implementação ainda não iniciada. Recomenda-se **execução nativa**, mantendo uma única implementação dos contratos compartilhados e revisão do conjunto ao final. Alternativa: subagentes por tarefa, com revisão por tarefa e maior custo de contexto. O usuário precisa revisar este plano e escolher o método antes do código, conforme a skill `superpowers:writing-plans`.
