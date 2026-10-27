# Fidelidade, regressão integral e produção pública — desenho técnico

**Baseline:**27/10/2026. **Origem:** escopo aprovado e contrato próprio detalhado por solicitação do operador. Implementação pendente nos pacotes abaixo.

**PRD:** [completo](2026-10-27-prometeus-cadence-complete-prd.md). **Arquitetura/segurança/execução:** [contratos compartilhados](2026-10-27-prometeus-cadence-technical-contracts.md).

## Abordagem e reutilização

Adotar evolução dos serviços e telas existentes. Reescrita de backend ou segunda fila foi descartada porque duplicaria autoridade, quotas e efeitos. As escolhas técnicas complementam a aprovação do escopo; não são observações novas sobre o backend do CadenceFlow.

Base inspecionada:

- docs/reverse-engineering/visual-2026-10-25/inventory/routes.md
- docs/validation/06-events-performance.md
- scripts/runtime-supervisor.ts
- src/server/auth/auth.ts
- src/server/billing/signature.ts

## Jornada

Aceites por pacote → inventário de estados/requisitos → regressão de jornadas/segurança/UI → perfil de carga/recuperação → backup/restauração → readiness → liberação autorizada e rollback disponível.

## Regras e limites de responsabilidade

- 06A-V é porta contínua;08A consolida e não recebe toda a dívida visual. Estados desconhecidos da referência são classificados, não aceitos automaticamente.
- Produção pública precisa de origemHTTPS/proxy confiável/mailer real/segredos/isolamento e serviços duráveis. O servidorlocalhost saudável não comprova publicação.
- 08B inclui o delta explícito Stripe test/live atualmente ausente, mantendo default test e habilitação live separada. Aprovação de desenvolvimento não autoriza cobrança/envio de produção.
- Host/domínio/credenciais/aprovações jurídicas e de fornecedor são entradas manuais operacionais. Falta de entrada impede gate correspondente, mas não exige redefinir jornada do produto.
- Critérios de carga/restore são metas próprias antes da medição, não resultados já comprovados. Regressões não podem expor banco ou credenciais de clientes.

## Contratos por pacote

### 06A-V — Fechamento visual contínuo e diferenças residuais

**Requisitos:** R24. **Dependências:** porta contínua das áreas existentes.

**Persistência:** Nenhuma tabela de produto nova; evidência/manifest de validação versionados.

**DTOs novos:**

```ts
type VisualCoverageInput={inventoryPath:string,evidenceRoot:string};
type VisualCoverageReport={total:number,compared:number,openDifferences:string[],unknownReference:string[],approvedExceptions:string[]};
```

**Serviços:**

```ts
declare function auditVisualCoverage(input:VisualCoverageInput):Promise<VisualCoverageReport>;
```

**HTTP/entrada:** NenhumaAPI nova. Usar rotasautorizadas existentes; conferir controles e requestsapenasnosescopos de QA.

**Regra executável:** Importarinventário 50 rotas/estados/overlays já conhecido; não repetirvarredura inteira semmudança. Priorizarresíduos documentadosEV271(contextocampos/ícones/feedback) e diferençaspréexistentes porárea. Medirgeometria/fonte/espaçamento/cor/foco/carga/falha, comparar antes/depoismesmo viewport/dados; CSScompartilhado nãoaceita todasinstâncias. Arte/brandingpróprios ficam divergências classificadas. Cada pacote adicionaprópriosexemplos e 08Aconsolida.

**UI:** `inventário completo routes.md`, `/settings/context`, `todas abas/popups por pacote`. Réplicainicial preservada; nenhumaestética nova nem substituição por cardsgenéricos. Capturascomdadospessoais mascaradas; acessibilidade/erro melhoram semalterarhierarquiaobservada.

**Gate externo/aceite:** Estados pagos/conectados semsessãoautorizada permanecemnãoobservados; não contratarreferência para obter screenshot. Correçõeslocais não podemdeclará-losaceitos.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-06av-visual-closure.md).

### 08A — Regressão integral de jornadas e UI/UX

**Requisitos:** R24, R01, R07, R09, R18, R21. **Dependências:** 06G, 07B.3, 07C.3, 06A-V.

**Persistência:** Nenhuma tabela de produto nova; evidência/manifest de validação versionados.

**DTOs novos:**

```ts
type ReleaseCoverageInput={manifestPath:string,evidenceRoot:string};
type ReleaseCoverageReport={required:number,passed:number,failed:string[],blocked:string[],referenceUnknown:string[],exceptions:string[]};
```

**Serviços:**

```ts
declare function auditReleaseCoverage(input:ReleaseCoverageInput):Promise<ReleaseCoverageReport>;
```

**HTTP/entrada:** SemnovasAPIs; exercitarserviços/rotas públicos eprivados daplataforma em QA próprio. Contratosexternos sócontasoperador.

**Regra executável:** Materializarregistrodetodasrotas/estados/roles/coortes/2 tenants. Jornadas obrigatórias: signup→trial→assinatura; pesquisa→pessoas→qualifica→cadência→inbox/parada; LinkedInconectado→açãoautorizada→conversa; SDR→handoff/agenda/CRM; pack/renova/cancel; delete/export/merge; API/MCPescopos/revoke. Rodar 1920/1440/768/390/320, tema/texto/teclado/zoom 200, falsosatrasos/offline/503. Capturasevidências vinculadas aRQ/pacote. Semcritical/highabertos; exceção deobservação não vira funcionalidade local dispensada.

**UI:** `todas rotas do inventário`, `todasabas/menus/popups/fluxos`, `desktop/tablet/mobile`. Regressão final não recebe dívidainteira devisual; cada área chegaaceita. Diferençasabertas retornam aoplanodono com teste, semreplanejar escopo completo.

**Gate externo/aceite:** Referênciaunknownclassificada e limitaçãoremotaregistrada sãoaceitas comolimite deprova, não licença para deixarfunção local incompleta. QR/OAuth/checkoutreturnnão bastam.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-08a-final-regression.md).

### 08B — Homologação e operação de produção pública

**Requisitos:** R25, R26, R01. **Dependências:** 08A.

**Persistência:** Nenhuma tabela de produto nova; evidência/manifest de validação versionados.

**DTOs novos:**

```ts
type ProductionInputs={origin:string,backupEvidence:string,rollbackEvidence:string,providerAttestations:string[],loadEvidence:string};
type ProductionReadinessReport={ready:boolean,blockers:string[],checks:{name:string,passed:boolean,evidence:string}[]};
```

**Serviços:**

```ts
declare function verifyProductionReadiness(input:ProductionInputs):Promise<ProductionReadinessReport>;
```

**HTTP/entrada:** ReadinessGET privado admin/health separado de livenesssemsegredos; app público apenas reverseproxyHTTPS; entradawebhookassinada eOAuthorigens reais. NenhumadminDBexposto.

**Regra executável:** DeployDockerLinux emhostdefinido pelooperador, volumeDB/blobs/sessõesOpenWAprivados, health/restart/drain. ConfigurartrustedproxyIPreal,securecookies/origin/CSP/CSRF, allowlistcallbacks, autenticaçãoadmin e SMTPtransacionalreal(replaceMailhog). Stripehojevalida livemodefalse: introduzir modoexplicitotest/live comchaves/webhook/catalogoseparados e validaçãoconsistente,default test eefeitoslive somente apósativaçãoexpressa. PublichostedChatGPTOAuth exigehabilitação própria ou usarAPI central suportada; não assumirpermissãocomercial. Backupcriptografadodiário+WAL/PITR seinfraoferecer; alvoRPO<=24 h/RTO<=4 h demonstradosemrestoreisolado. Fillidempotentedos 40 grantsantigosreferênciaP3, preservarledger. Migraçãoforwardcompat/rollbackapp, nuncaeditar 082 anteriores.

**UI:** `/login`, `/register`, `/dashboard`, `/settings/plan`, `/settings/ai`, `todas jornadas públicas de08A`. Mensagensdeerro deprodução segurasúteis, suporte/statusfuncionais; origemsempreHTTPS e links/callbacks corretos. Semterminalsvisíveis em Windowslocal; produção semdependência dodesktop.

**Gate externo/aceite:** Entradasmanuais: domínio/host/acessos, identificação/documentosjurídicosdefinitivos, DNS/SMTP, aprovações deprovedor, budget/contasde QA. Não marcar deploypúblico/pagamentolive pronto semessasprovas e açãoexternaautorizada. Código e runbookprontos não significamproduçãoativada.

**Plano:** [tarefas](../plans/2026-10-27-prometeus-cadence-08b-public-production.md).

## Falhas, operação e critérios de pronto

Revalidar sessão/associação/política antes e depois de I/O. Não repetir efeito incerto; manter receipt e encaminhar à reconciliação. Cache, paginação e locks incluem workspace. Cada pacote deve passar caso feliz, bloqueio, falha/recuperação, permissão/isolamento e comparação visual no estado/viewport declarado, com evidência de execução real ou controlada separada.

Fora deescopo: funcionalidades não listadas no PRD, rebranding próprio, copiar backend privado não observado ou vender integração sem aceite. Parâmetros de fornecedor/implantação ficam nos gates; mudança de alternativa registra impacto e equivalência sem reabrir o produto inteiro.
