# Catálogo comercial e descoberta condicional — desenho técnico

**Baseline:**27/10/2026. **Origem:** escopo aprovado e contrato próprio detalhado por solicitação do operador. Implementação pendente nos pacotes abaixo.

**PRD:** [completo](2026-10-27-prometeus-cadence-complete-prd.md). **Arquitetura/segurança/execução:** [contratos compartilhados](2026-10-27-prometeus-cadence-technical-contracts.md).

## Abordagem e reutilização

Adotar evolução dos serviços e telas existentes. Reescrita de backend ou segunda fila foi descartada porque duplicaria autoridade, quotas e efeitos. As escolhas técnicas complementam a aprovação do escopo; não são observações novas sobre o backend do CadenceFlow.

Base inspecionada:

- src/domain/billing.ts
- src/server/billing/operations.ts
- src/server/billing/events.ts
- src/server/billing/entitlements.ts
- src/modules/settings/billing-catalog.tsx

## Jornada

Catálogo versionado com recurso operacional → seleção/quantidade/período/cupom → revisão de preço/vigência → efeitoStripe → webhook/reconciliação → direitos e consumo no app.

## Regras e limites de responsabilidade

- Preservar trial de 7 dias e pacotes deconsumo pré-pagos. Capacidade recorrente e franquia renovável são unidades diferentes dos créditos semexpiração.
- Stripe é fonte autoritativa de pagamento/subscriptionitem; retorno decheckout não concede direitos. Eventos duplicados e fora deordem conciliam estado atual.
- O plano anual altera cobrança, não entrega 12 meses de consumo deuma vez; datas mensais de quota são registradas e conciliadas. Redução de capacidade protege dados e owner.
- 07D é condicional: descoberta deve terminar eminclude/exclude explícito. Se a oferta não confirma, não implementar feature especulativa nem anunciar benefício. Se incluir com regra própria, sua origem e limites ficamvisíveis.

## Contratos por pacote

### 07D — Descoberta condicional de scoring e Hot Now

**Requisitos:** R23. **Dependências:** 06C.2, 06B.5.

**Persistência:** Somente se gateconfirmado: scoring_policy e lead_score_projection; versão/eventsequência/replay, semcorpo deconversa

**DTOs novos:**

```ts
type ScoringDiscovery={offerConfirmed:boolean,evidenceRefs:string[],contractRecorded:boolean};
type ScoringDecision={enabled:boolean,reason:string};
type ScoreInput={leadId:string,asOf:string,events:{id:string,kind:"qualified"|"human-reply"|"meeting",at:string}[]};
type ScoreView={leadId:string,score:number,tier:"cold"|"warm"|"hot",policyVersion:string,reasons:string[]};
```

**Serviços:**

```ts
declare function decideScoringScope(input:ScoringDiscovery):ScoringDecision;
declare function projectLeadScore(input:ScoreInput):ScoreView;
```

**HTTP/entrada:** Se gateaprovado GET /api/scoring?cursor&period; antes disso sem endpointoperacional nem oferta. Decisão em docs/validation/07 d-discovery.md.

**Regra executável:** Task 1 descoberta deoferta atual eorigem, registarinclude/exclude. Seexcluído, não criafontesproduto/DBtestplan alémdecisão; requisitoR23 fecha exclusãodocumentada. Seincluídoe regra interna nãoobservável: contrato próprio version 1 +20 qualified/+30 humanreply/+50 meeting únicosúltimos 30 dias; após 7 dias peso 50%, após 30 dias 0; clamp 100;tiershot>=50/warm>=20. Diferenciarengagement de probabilidadecomercial. Semusar aberturainexistente. Antes deoferecer aceitarregra própria/visual noslimites deobservação.

**UI:** `/dashboard`, `/contacts`, `/reports`. Seseconfirmar, chip/ordenação/explicaçãopontuação noslocaisobservados; casoexcluído não deixarfiltrosquebrados. Regraspróprias não afirmambackend concorrente.

**Gate externo/aceite:** Pacotecondicional: só Task 1 é obrigatória para decisão. Tasks 2/3 deproduto executam apenas seconfirmado econtratoregistrado; evidênciaoffertacontinua lacuna externa, não tarefaTBD.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-07d-scoring-discovery.md).

### 06G — Catálogo completo, anual, cupom e capacidade

**Requisitos:** R22. **Dependências:** 06A-H, 07A.3, 07B.3.

**Persistência:** billing_catalog_version, capacity_subscription_item, billing_coupon_claim, entitlement_schedule; fonteStripeautoritativa e datasdeconsumo/capacidade distintas

**DTOs novos:**

```ts
type CatalogChange={kind:"plan"|"capacity"|"coupon",sku:string,quantity:number,interval:"month"|"year",coupon?:string,catalogVersion:string};
type CapacityView={used:Record<string,number>,allowed:Record<string,number>,scheduled:Record<string,number>|null,effectiveAt:string|null};
```

**Serviços:**

```ts
declare function prepareCatalogChange(p:Principal,input:CatalogChange):Promise<Reviewed<CatalogChange>>;
declare function confirmCatalogChange(p:Principal,input:Confirm<CatalogChange>):Promise<{operationId:string}>;
declare function readCapacity(p:Principal):Promise<CapacityView>;
```

**HTTP/entrada:** Reusar GET /api/billing e POST /api/billing/{trial,prepare,confirm,contact,reconcile}, que são as ações reais atuais. Fluxo de portal/payment-method continua tipo de operação dentro de prepare/confirm, não endpoint /portal. Ampliar schemas de input/review para annual-change/capacity/coupon, sem permitir preço arbitrário do cliente.

**Regra executável:** Preservar prépagoconsumo e 7 diastrial. Anual 20%desconto: Essential 381120 centavos/ano,Pro 861120 centavos/ano;franquiaconsumo renova mensal no aniversáriointerno mesmo cobrançaanual. Catálogocapacidadeobservado email 1900/mes,WA4900/mes,assento 5900/mes,LinkedIn 14900/mes sujeito módulooperacional;não introduzircobrançaenrichmentrecorrentecontráriaa prépago. Aumento capacidade apósinvoicepaga eprorratarevisada; reduçãoprogramadapróximoperíodo com seleção explícita de recursos. CouponvalidadoStripe,campanhavalidade/maxuses server-side. Nenhumdireito porretorno checkout; webhooksforaordem conciliamitematual. Atualizar handler src/server/billing/http.ts, schemas de prepare/confirm e o discriminante de BillingReview na mesma entrega; ações de retorno não concedem direito. Portal é resultado de operação, não nova rota livre. Preservar informações de uso e cadastro de contato da cobrança já funcionais.

**UI:** `/settings/plan:meu-plano`, `/settings/plan:cobranca`, `/settings/plan:planos-pacotes`. Preservarvisualaprovado; seleçãoqtd/período/cupom e revisão comvalor agora/renovação/vigência; uso/franquia/saldo/capacidade distintos e recursos indisponíveis não contratáveis.

**Gate externo/aceite:** Valorespreços sãoespelho do catálogo observado comdivergências aprovadas; antesprovisionar confirmarSKUversionado. Sandboxprimeiro; ativaçãolive éaçãoexternaexplícita em 08B.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-06g-commercial-catalog.md).

## Falhas, operação e critérios de pronto

Revalidar sessão/associação/política antes e depois de I/O. Não repetir efeito incerto; manter receipt e encaminhar à reconciliação. Cache, paginação e locks incluem workspace. Cada pacote deve passar caso feliz, bloqueio, falha/recuperação, permissão/isolamento e comparação visual no estado/viewport declarado, com evidência de execução real ou controlada separada.

Fora deescopo: funcionalidades não listadas no PRD, rebranding próprio, copiar backend privado não observado ou vender integração sem aceite. Parâmetros de fornecedor/implantação ficam nos gates; mudança de alternativa registra impacto e equivalência sem reabrir o produto inteiro.
