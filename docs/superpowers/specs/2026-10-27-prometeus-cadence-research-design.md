# Prospecção completa e inteligência — desenho técnico

**Baseline:**27/10/2026. **Origem:** escopo aprovado e contrato próprio detalhado por solicitação do operador. Implementação pendente nos pacotes abaixo.

**PRD:** [completo](2026-10-27-prometeus-cadence-complete-prd.md). **Arquitetura/segurança/execução:** [contratos compartilhados](2026-10-27-prometeus-cadence-technical-contracts.md).

## Abordagem e reutilização

Adotar evolução dos serviços e telas existentes. Reescrita de backend ou segunda fila foi descartada porque duplicaria autoridade, quotas e efeitos. As escolhas técnicas complementam a aprovação do escopo; não são observações novas sobre o backend do CadenceFlow.

Base inspecionada:

- src/server/prospecting/service.ts
- src/server/prospecting/enrichment.ts
- src/server/prospecting/providers/profiles.ts
- src/server/prospecting/ai/platform.ts
- src/server/planning/confirmation.ts

## Jornada

Pedido revisado → pesquisa da empresa → identidade/CNPJ → pessoas e contatos atribuídos → qualificação → aplicação revisada → rascunho de cadência → publicação separada.

## Regras e limites de responsabilidade

- A cadeia é adaptativa e limitada; ausência de site/CNPJ/perfil não transforma dados presumidos em fatos. Fontes de rede social complementam a investigação quando seu perfil tipado está habilitado pelo admin.
- Empresa, pessoa, vínculo e contato são entidades distintas. Um gestor não precisa ser sócio; nome sem contato não satisfaz a regra comercial de resolução útil já existente. Contato comercial não vira pessoal por proximidade textual.
- Os resultados apresentados ao cliente pertencem ao workspace. Reuso de infraestrutura não permite cache privado compartilhado entre clientes. Cada campo informa fonte e data; atualidade da coleta não prova atualidade do dado publicado.
- Cobrança técnica do fornecedor é independente da quota comercial. Aplicação/repetição não consomem novamente; nova consulta paga após invalidação exige nova estimativa/aceite. Reservas bloqueiam concorrência e cada estágio salva checkpoints.

## Contratos por pacote

### 06B.3 — Investigação da empresa e redes

**Requisitos:** R02, R03, R05. **Dependências:** 06IA, 06B.1, 06B.2.

**Persistência:** research_case, research_source, research_fact; chave(workspace_id,lead_id,case_version); UNIQUE(workspace_id,operation_key)

**DTOs novos:**

```ts
type CompanyResearchInput={leadIds:string[],sourceKinds:("website"|"social"|"registry")[],maxPagesPerCompany:number};
type ResearchCaseView={id:string,revision:number,state:string,facts:ResearchFact[],missing:string[]};
type ResearchFact={id:string,field:string,value:string,evidence:EvidenceRef[],attribution:"company"|"uncertain"};
type ResearchAdapters={collect:(source:string,urls:string[],signal:AbortSignal)=>Promise<EvidenceRef[]>};
type ResearchApplication={caseId:string,factIds:string[],expectedRevision:number};
```

**Serviços:**

```ts
declare function prepareCompanyResearch(p:Principal,input:CompanyResearchInput):Promise<Reviewed<CompanyResearchInput>>;
declare function confirmCompanyResearch(p:Principal,input:Confirm<CompanyResearchInput>):Promise<ResearchCaseView>;
declare function runCompanyResearch(lease:JobLease,deps:ResearchAdapters):Promise<void>;
declare function prepareResearchApplication(p:Principal,input:ResearchApplication):Promise<Reviewed<ResearchApplication>>;
declare function confirmResearchApplication(p:Principal,input:Confirm<ResearchApplication>):Promise<{applied:number}>;
```

**HTTP/entrada:** POST /api/research {action:prepare|confirm,input:{leadIds:string[],sourceKinds:string[],maxPagesPerCompany:number},token?,requestId?}; GET /api/research/:id; POST /api/research/:id/cancel; POST /api/research/:id/apply com fatos selecionados/revisão

**Regra executável:** Registrar perfis centrais habilitados sem trocar allowlist por Actor arbitrário. Usar WEB/Maps/site já coletados, procurar links sociais e corroborar identidade por domínio/CNPJ/endereço antes de aceitar fatos. Limitar 10 páginas/empresa; aplicar no máximo 500 leads/rodada e continuar com partial por falha de uma fonte. Checkpoints/receipts e custo técnico usam journal existente; aplicação à base é revisada. Aplicar pesquisa revalida campo/fonte/hash, revisão do lead e caso e grava campos suportados com origem em uma transação. Não sobrescrever valor humano conflitante sem escolha explícita da revisão; fatos uncertain ficam somente na pesquisa até resolução. Perfis novos de rede social são configuração central protegida por isPlatformAiAdmin, sem aceitar Actor/build enviados no pedido do cliente.

**UI:** `/leads/generator?source=MAPS`, `/leads/generator?source=WEB`, `/contacts`, `/leads/[id]`, `/executions/[id]`. Reaproveitar formulário→revisão→progresso→resultado. Detalhe mostra fonte/data e fatos não encontrados; ações aplicar/descartar respeitam revisão; fontes técnicas não aparecem como exigência do cliente.

**Gate externo/aceite:** Antes de ativar rede adicional: contrato I/O/build/custo/acesso e amostra controlada registrados. Sem fonte nova pronta, exibir cobertura indisponível; não declarar a rede homologada.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-06b3-company-research.md).

### 06B.4 — Identidade empresarial e tomadores de decisão

**Requisitos:** R04, R05. **Dependências:** 06B.3.

**Persistência:** research_company_identity, research_person, research_person_company, research_person_contact; FK por workspace; UNIQUE(workspace_id,case_id,identity_key)

**DTOs novos:**

```ts
type CompanyIdentity={caseId:string,cnpj:string|null,legalName:string|null,state:"resolved"|"conflict"|"missing",evidence:EvidenceRef[]};
type PersonContact={kind:"email"|"phone"|"linkedin",value:string,attribution:"personal"|"corporate"|"unresolved",evidence:EvidenceRef[]};
type CompanyPerson={id:string,name:string,role:string,relationship:"partner"|"manager"|"unknown",contacts:PersonContact[],current:"supported"|"uncertain"};
type PeopleApplication={caseId:string,personIds:string[],expectedRevision:number};
type PeopleAdapters={registry:(query:string)=>Promise<EvidenceRef[]>,search:(name:string,company:string)=>Promise<EvidenceRef[]>};
```

**Serviços:**

```ts
declare function resolveCompanyIdentity(p:Principal,caseId:string):Promise<CompanyIdentity>;
declare function resolveCompanyPeople(lease:JobLease,deps:PeopleAdapters):Promise<void>;
declare function preparePeopleApplication(p:Principal,input:PeopleApplication):Promise<Reviewed<PeopleApplication>>;
declare function confirmPeopleApplication(p:Principal,input:Confirm<PeopleApplication>):Promise<{applied:number}>;
```

**HTTP/entrada:** GET /api/research/:id/people; POST no mesmo endpoint {action:prepare-apply|confirm-apply,personIds:string[],expectedRevision:number,token?,requestId?}

**Regra executável:** Resolver CNPJ pelo site ou razão social mais sinais concordantes; múltiplas empresas viramconflict. ReaproveitarQSA sem guardarCPF/idade; buscar donos e gestores não sócios por nome+empresa/cargo. Candidato sem contato útil continua pessoa/vínculo no caso de pesquisa, separado do Decisor entregável atual; não afrouxar validateDecisorEvidence para fingir enriquecimento. Página pessoal explícita exige vínculo corroborado; ausência de contato não bloqueia contexto.

**UI:** `/leads/enrich`, `/leads/[id]`, `/contacts`, `/linkedin/enrichment`. Empresa e pessoa têm rótulos separados, fonte por campo, vínculo/atualidade incertos visíveis e revisão antes de criarcontato na lista. Reusar apresentação de enriquecimento, com estado sem resultado útil explícito.

**Gate externo/aceite:** LinkedIn como fonte de pesquisa depende do perfil de dados habilitado e não da API de convites. Falta de cobertura de perfil/contato gera ausência explícita, sem garantir celular pessoal.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-06b4-company-people.md).

### 06B.5 — Jornada integrada de prospecção e cadência

**Requisitos:** R05, R07. **Dependências:** 06B.3, 06B.4, 06D.1, 06D.2.

**Persistência:** prospecting_journey, journey_stage; UNIQUE(workspace_id,request_id), vínculos a jobs/listas/propostas atuais, estados/checkpoints versionados

**DTOs novos:**

```ts
type JourneyInput={brief:string,location:string,limit:number,destinationListId?:string};
type JourneyView={id:string,revision:number,state:string,stages:{name:string,jobId:string|null,state:string}[],listId:string|null,proposalJobId:string|null};
type JourneyStage="discover"|"research"|"people"|"qualify"|"review"|"cadence";
```

**Serviços:**

```ts
declare function prepareJourney(p:Principal,input:JourneyInput):Promise<Reviewed<JourneyInput>>;
declare function confirmJourney(p:Principal,input:Confirm<JourneyInput>):Promise<JourneyView>;
declare function advanceJourney(lease:JobLease):Promise<JourneyView>;
```

**HTTP/entrada:** POST /api/prospecting/journeys {action:prepare|confirm,input:{brief,location,limit,destinationListId?},token?,requestId?}; POST /:id/{cancel,resume,prepare-cadence,confirm-cadence}; GET usa rota /api/prospecting/journeys?id=...

**Regra executável:** Orquestrador referenciajobs existentes sem criarworkerduplicado. Brief/contexto/produto são congelados na revisão; cada estágio usa chave journeyId+stage+company+version. Pausa retémresultados;resume aproveita checkpoints ainda válidos e apresenta novo custo se invalidou. Cadência sugeridapadrão 3 etapas editáveis, canais disponíveis e variáveis permitidas; quantidade não é limite fixo. Criação sórascunho atépublicação 06D.

**UI:** `/leads/generator`, `/automations/new/ai`, `/executions/[id]`, `/contacts`, `/cadences/new`. Cliente usa umobjetivo e acompanha etapas compreensíveis; revisão e sugestões aproveitam aUX existente sem assistente técnico de APIs. Não prometercontagem de contatos pessoais garantida.

**Gate externo/aceite:** Aceite pontaaponta depende de 06D e de fontes habilitadas; contratos controlados não substituempiloto de acurácia 06IA-H.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-06b5-prospecting-journey.md).

### 06IA-H — Homologação das fontes e inteligência

**Requisitos:** R06. **Dependências:** 06B.5, 06IA.

**Persistência:** ai_evaluation_run, ai_evaluation_case; snapshots de versões/receipts/métricassem dados brutos pessoais no relatório público

**DTOs novos:**

```ts
type EvaluationInput={datasetVersion:string,caseIds:string[],mode:"fixture"|"live-owned",maxCostUsd:number};
type EvaluationAdapters={run:(caseId:string)=>Promise<{facts:number,supported:number,attributionCorrect:number,costUsd:number|null,durationMs:number}>};
type EvaluationReport={runId:string,accepted:boolean,unsupportedFacts:number,crossTenantLeaks:number,attributionPrecision:number,coverage:number,costUsd:number|null,unknownCosts:number};
```

**Serviços:**

```ts
declare function evaluateResearch(input:EvaluationInput,deps:EvaluationAdapters):Promise<EvaluationReport>;
```

**HTTP/entrada:** Sem nova API de cliente. ExecuçãoCLI administrativa; leitura resumida apenas por admin da plataforma, reaproveitando guardplatformAI.

**Regra executável:** Dataset versionado com 30 casos: empresascom/sem site, sociaisconfusas, QSAsemcontato, homônimos, gestor não sócio, fonte ausente e instruçãoinjetada. Avaliartradicional e híbrido com mesmasevidências. Gates próprios:0 vazamentos/0 fatossemcitação, precisão deatribuição>=95% sobre casosrotulados e 100%abstenção noscasos semsuporte; cobertura e custo reportados sem garantia comercial. Publicarversão de skill só após regressão;live opt-in tetoUSDpositivo e bloqueioquandoatingido.

**UI:** `/settings/ai`, `/settings/context`, `/leads/enrich`. Cliente recebeestado/cobertura/ausênciahonestos, sem scoresdeconfiança promocionais; admin recebe relatório versionado queexplica falhas e custo.

**Gate externo/aceite:** Produção/fornecedor pago sórecebem aceite empírico após piloto real controlado; fixture prova contrato, não acurácia nomundo real.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-06iah-intelligence-homologation.md).

## Falhas, operação e critérios de pronto

Revalidar sessão/associação/política antes e depois de I/O. Não repetir efeito incerto; manter receipt e encaminhar à reconciliação. Cache, paginação e locks incluem workspace. Cada pacote deve passar caso feliz, bloqueio, falha/recuperação, permissão/isolamento e comparação visual no estado/viewport declarado, com evidência de execução real ou controlada separada.

Fora deescopo: funcionalidades não listadas no PRD, rebranding próprio, copiar backend privado não observado ou vender integração sem aceite. Parâmetros de fornecedor/implantação ficam nos gates; mudança de alternativa registra impacto e equivalência sem reabrir o produto inteiro.
