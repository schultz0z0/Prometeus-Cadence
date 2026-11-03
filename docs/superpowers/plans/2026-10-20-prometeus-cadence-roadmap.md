# Prometeus Cadence — roteiro de implementação

Especificação aprovada: `docs/superpowers/specs/2026-10-20-prometeus-cadence-design.md`.

O roteiro abaixo cobre o produto completo. Os pacotes restantes têm planos executáveis no [índice mestre de27/10](2026-10-27-prometeus-cadence-master-plan.md), alinhados ao PRD e aos contratos técnicos, sem prometer integrações a partir de mocks.

**Revisão vigente:27/10/2026.** O alvo é a réplica visual, dos fluxos e das funcionalidades de produto; o usuário não exige comprovar uma implementação interna idêntica ao backend privado da referência. A implementação própria continua sujeita a testes reais. Regras não observadas recebem contrato explícito e classificação, sem bloquear todo o roteiro nem serem apresentadas como verificadas no concorrente. Detalhamento e critérios em [Fechamento de paridade](2026-10-26-prometeus-cadence-parity-closure.md), complementado pela [extensão de escopo aprovada em27/10](../specs/2026-10-27-prometeus-cadence-scope-audit.md). Esta última prevalece nas subdivisões e prioridades alteradas.

## Como ler a numeração do desenvolvimento completo

**Documentação integral solicitada em27/10:** [PRD consolidado](../specs/2026-10-27-prometeus-cadence-complete-prd.md), [contratos técnicos compartilhados](../specs/2026-10-27-prometeus-cadence-technical-contracts.md) e [índice mestre com26planos por pacote](2026-10-27-prometeus-cadence-master-plan.md). O índice liga requisitos, desenhos de8áreas, arquivos, interfaces, migrações, tarefas, testes, UI/UX e entradas externas até08B. Esta etapa escreve/valida documentos; não implementa os pacotes pendentes. Planos históricos já entregues permanecem referenciados, sem serem reescritos como trabalho novo.

As famílias continuam sendo **01 a08**. Letras e sufixos dividem uma família em entregas menores:06B.3 é o terceiro pacote da área06B, dentro do marco06. Os IDs preservam o histórico e não são a ordem cronológica obrigatória.06B/06D não substituem07/08. **Não há marco09 definido no roteiro vigente; o encerramento previsto é08B.**

| Família | Papel no desenvolvimento completo |
|---|---|
| **01–05** | Base de interface, identidade, prospecção/IA, automações e canais; aceites históricos preservados, complementos tratados nos pacotes seguintes. |
| **06** | Fechamento do produto principal: prospecção completa, inteligência/fontes, cadências, dashboard, segurança, experiência e catálogo comercial. Parte já entregue e parte pendente, conforme relatórios. |
| **07** | LinkedIn, integrações/API/MCP eSDR;07D é descoberta condicional. OSDR é o último módulo funcional novo, após suas dependências. |
| **08** | Regressão integral visual/funcional e preparação/homologação de produção pública. |

A fidelidade visual/UX e a operação real são aceites de cada pacote, não trabalho adiado integralmente para08. Os planos executáveis futuros serão detalhados por pacote; a aprovação do roteiro completo não equivale a implementação concluída.

| Marco | Entrega independente | Dependência | Aceite |
| --- | --- | --- | --- |
| 01 | Interface fiel, dados demonstrativos persistentes no navegador e fluxos completos de revisão/rascunho | Levantamento concluído | Plano detalhado `2026-10-20-prometeus-cadence-01-interface.md` |
| 02 | Cadastro, login, workspace, papéis, banco e migrações | Contratos de domínio do 01 | Dois clientes isolados, sessão real e dados persistentes no servidor |
| 03 | Adaptadores de geração, extração e qualificação; jobs e uso | 02 + escolha/credenciais dos provedores | Prospecção real por fonte, cancelamento, deduplicação e ledger |
| 03B | Roteamento configurável, LLM convencional completa e JEV acompanhado | 03 | Política isolada por workspace, teste confirmado e três inferências Codex reais |
| 04 | Contexto e propostas de IA reais, criação atômica e scheduler | 02 e 03 | Nenhuma sugestão cria dados; confirmação idempotente; execução recorrente |
| 05 | E-mail, WhatsApp, cadências em produção e inbox | 02–04 + credenciais | Limites agregados, resposta/opt-out, falhas, retries e reconciliação |
| 06A | Auditoria atualizada + assinatura Stripe em teste, catálogo, renovação e pacotes de consumo pré-pagos | 02 e contratos de uso | Catálogo versionado, eventos autenticados/idempotentes, quota no servidor, nenhuma concessão por retorno do checkout |
| 06A-V | Fechamento das diferenças visuais conhecidas de todas as áreas e porta visual de cada marco | Inventário observado e06A | Comparação por tela/estado/viewport, incluindo assistente lateral, popups, geometria e responsive; contagem de visitas não equivale a aceite visual |
| 06A-P · novo | Entrada pública, cadastro e ativação | 02 e06A-V | Telefone/documentos próprios com contrato real; cadastro/verificação/workspace/plano, senha, convites e retornos/erros; sem ativação automática |
| 06A-H · novo | Homologação do ciclo financeiro já implementado | 06A e sandbox próprio | Pacotes, pagamento, alteração, renovação/falha, cancelamento e retomada suportada; efeitos únicos, eventos duplicados/fora de ordem; sem cobrança live |
| 06B | Contatos, fontes, investigação, qualificação e jornada completa de prospecção | 03–04 + unidades comerciais do06A;06IA;06D para fechar06B.5 |06B.1 base/importação/busca/IA e06B.2 qualificação/enriquecimento nos aceites históricos;06B.3 empresa/site/redes/contatos comerciais;06B.4 CNPJ/sócios/gestores/perfis/contatos atribuídos;06B.5 orquestração/revisão/sugestão de cadência, recuperação e consumo sem duplicação |
| 06IA · novo | Administração central e inteligência adaptativa de IA | 06B.2 e contexto privado da empresa | Apify/LLM configurados exclusivamente pelo administrador do SaaS; cliente não fornece chaves nem escolhe a infraestrutura. Instruções versionadas por tarefa + contexto/público-alvo do workspace + pedido atual; JEV/LLM, abstenção, fontes, isolamento, consumo e avaliações verificáveis |
| 06IA-H | Homologação da inteligência e das fontes ampliadas | 06IA,06B.3/4/5 e contratos de06D | Cenários controlados de pertinência/cobertura/atribuição/homônimos, custos/tempo, dados reais dos Actors e avaliações LLM/JEV; critérios definidos antes do piloto, orçamento e isolamento comprovados; não repetir infraestrutura já aceita |
| 06C | Eventos, desempenho, dashboard, relatórios, execuções e notificações | 03–06A; projeções consomem eventos de06B/06D |06C.1 eventos/latência/atualização contínua;06C.2 projeções reconciliadas;06C.3 feed/som/avisos/resumos reais; nenhum dado demonstrativo apresentado como operação |
| 06D | Autoria, publicação, canais e inbox | 05,06B e OpenWA |06D.1 modelos/variantes/anexos/rascunho/agenda;06D.2 entrega/resposta/opt-out e telemetria suportada; reinício sem duplicação e piloto próprio autorizado |
| 06E | Segurança, privacidade e ciclo de dados/membros | 02,06A-P e06A |06E.1 TOTP/dispositivos/convites/permissões;06E.2 mesclagem/retenção/exportação/exclusão reais, conteúdo removido fora da IA, isolamento |
| 06F · novo | Experiência transversal, assistente, busca, onboarding e ajudas | 03B–04,06C e comandos dos módulos disponíveis | Painel conversacional com contexto/permissão, propostas revisadas, busca no escopo observado, tours/checklist e destinos reais; aparência e operação verificadas separadamente |
| 07A | LinkedIn: viabilidade e três pacotes de operação | 06A,06B,06D,06E e capacidades comprovadas em07A.0 |07A.0 viabilidade/permissões;07A.1 conexão/saúde/sincronização;07A.2 público/campanhas/convites/aceites;07A.3 conversas/pipeline/cadências/aprovações e limites; ações indisponíveis bloqueadas e contratos próprios explícitos |
| 07B | SDR em três pacotes, último módulo funcional novo | 06D,06E,06F e operações reais de07C.1/07C.2; demais módulos novos antes do fechamento |07B.1 configuração/conhecimento/horários/regras;07B.2 conversa/memória/qualificação/limites/handoff;07B.3 agenda/CRM/follow-up e piloto em contas próprias; não depende de provar o backend original |
| 07C | Integrações, API/eventos, agenda e MCP em três pacotes | 02,06E e eventos/comandos do domínio |07C.1 API/outbox/webhooks/contratos de agenda e CRM;07C.2 adaptadores por workspace e fluxos externos;07C.3 MCP com escopos/confirmação/revogação |
| 06G · novo | Catálogo comercial completo e capacidade adicional | 06A-H e aceite dos recursos vendidos;07A/07B quando incluídos | Anual/cupom conforme catálogo-alvo, caixas/números/assentos com vigência e quotas; consumo pré-pago preservado; módulos pendentes continuam fora de venda |
| 07D | Descoberta e eventual entrega de Lead Scoring / Hot Now | Eventos de 06C/07B e confirmação da oferta atual | A documentação pública usa planos antigos; confirmar primeiro. Depois, eventos, decay, tiers e replay com fixture |
| 08A | Regressão final visual e funcional do inventário-alvo já exigida em cada marco | 06A–07C, incluindo06F/06G;07D conforme descoberta | Jornadas entre módulos, desktop/tablet/mobile, todos os estados catalogados, foco/teclado/tema/texto; contratos próprios testados e limites de observação explícitos |
| 08B | Operação e produção | 08A + contas próprias habilitadas | Backup/restauração, observabilidade, orçamento de latência, recuperação de provedores, isolamento, deploy/rollback e teste real autorizado |

**Sequência restante aprovada em27/10:**06B.3→06B.4→06D.1→06D.2→06B.5→06IA-H→06C.2/06C.3→06E.1/06E.2→06F→07C.1/07C.2→07A.1/07A.2/07A.3→07C.3→07B.1/07B.2/07B.3→06G→08A→08B. A viabilidade07A.0 será antecipada antes de comprometer a implementação operacional07A. Se07D for confirmado, encaixar sua entrega antes doSDR com as dependências satisfeitas; se depender de eventosSDR, usar contrato/fixtures antes e revalidar com eventos reais depois. Não prometer07D obrigatório sem confirmação.

06A-V continua porta de qualidade de todas as entregas e suas diferenças conhecidas precisam de fechamento; não é um aceite integral já obtido. Os aceites existentes de06A-P/06A-H/06C.1/06B.1/06B.2/06IA permanecem históricos, sem refazer essas entregas. Preparar contratos independentes antes é permitido; segurança, autorização e operação real continuam requisitos de todos os pacotes. OSDR usa agenda/CRM já operacionais, não apenas interfaces ou tipos preparados.06G fecha a oferta comercial depois do aceite dos recursos vendidos.

## Revisão por auditoria de 24/10/2026

O usuário autorizou expressamente novos marcos corretivos para áreas anteriores. A numeração original 01–05 é preservada como histórico de entregas; 06B–06E fecham lacunas de paridade encontradas, sem apagar os aceites já registrados.

Acervo atualizado: `docs/reverse-engineering/reaudit-2026-10-24/`. São 29 áreas catalogadas, 84 evidências, 18 regras observadas/ofertadas e inspeção de 26 arquivos locais no baseline `a63161f`. Consulte `clone/parity.md`, `findings.md` e `inventory/coverage.md`. Estados pagos/conectados e ações externas da referência não foram exercitados; ainda não existe evidência de paridade100%.

No baseline de24/10 foram identificados painéis sintéticos, enriquecimento só em prévia, relatórios simplificados e preferências sem executores. A auditoria visual posterior corrigiu muitas composições; não converteu automaticamente apresentações em serviços operacionais. A revisão26/10 rechecou11 telas pareadas e as implementações locais: notificações por evento, retenção, fusões, TOTP, adaptadores de apps, MCP, LinkedIn/SDR e partes da autoria ainda exigem os pacotes acima. Reaproveitar adaptadores, jobs, scheduler, reservas e configuração de IA existentes. O nome `useDemo` sozinho não prova persistência falsa: o modo autenticado injeta o repositório do workspace.

O catálogo atual da referência é Essential R$397/mês e Pro R$897/mês; opção anual com20% de desconto. O usuário permitiu reproduzir os planos. Há uma divergência comercial intencional: adicionais da referência são recorrentes, enquanto o usuário escolheu pacotes de consumo pré-pagos. Capacidade (assentos/caixas/números) não deve virar direito vitalício por engano. O desenho06A deve separar essas unidades e não habilitar cobrança real.

Diferenças preservadas: marca própria; OpenWA gerenciado em lugar de Twilio/Z-API; limites iniciais20/5; nenhuma promessa de imunidade a bloqueio; IA configurável; credenciais e infraestrutura próprias. Não copiar textos/modelos proprietários, métricas promocionais nem benefícios de terceiros como se fossem fornecidos pelo Prometeus.

Critério global: cada área fecha com interface, fluxo, contrato de regra, persistência, permissão, execução em segundo plano quando aplicável e falha/reconciliação testados no Prometeus. A matriz distingue observação, documentação antiga, inferência, implementação e homologação real. Após o esclarecimento de26/10, evidência do backend privado do concorrente não é pré-requisito para uma implementação funcional própria; a ausência dessa evidência continua explicitada. O relatório da auditoria24/10 está em `docs/validation/06-reaudit.md`.

## Correção de direção visual —25/10/2026

O usuário reiterou expressamente a réplica visual e funcional da referência antes de uma futura personalização Prometeus. Interface equivalente com aparência própria não satisfaz o aceite. A captura no mesmo viewport e estado, com comparação de estrutura, fonte, dimensões, espaçamento, cores, controles e popups, passa a ser requisito de cada marco06B–07D e de toda correção de marcos anteriores. O08A apenas consolida a regressão; não posterga fidelidade visual. As divergências comerciais e operacionais explicitamente escolhidas (trial7 dias, créditos pré-pagos, OpenWA) permanecem registradas. A correção imediata06A-V está em `docs/validation/06-visual-fidelity.md`.

## Decisões já fixadas

- Experiência principal por formulários, prévias, propostas e botões de confirmação.
- Fidelidade à estrutura observada, incluindo canvas, filtros, onboarding e estados vazios.
- Não assumir Apify, banco, fila ou modelo do concorrente sem evidência.
- Conta comercial própria e marca de trabalho Prometeus Cadence.
- Distinguir ambiente demonstrativo de integração real em toda entrega.
- Para novas recomendações/criações de recursos, seguir a consulta ao O Setup exigida pelo AGENTS.md vigente. Esta revisão reutiliza REA, RES e Playwright já disponíveis e não instala ferramentas.

## Recursos verificados nesta sessão

Node local `v24.16.0`, npm `11.13.0`, RTK e REA já disponíveis. Next.js/React foram observados no cliente da referência. A documentação oficial consultada confirma suporte de instalação e TypeScript: [Next.js — instalação](https://nextjs.org/docs/app/getting-started/installation). Também foi consultada a documentação de [comparação visual do Playwright](https://playwright.dev/docs/test-snapshots), sem instalação de novo runner nesta fase de planejamento.

## Estado

- [x] Especificação aprovada pelo usuário.
- [x] Roteiro geral e plano da primeira entrega escritos.
- [x] Usuário revisou o plano 01 e escolheu execução nativa.
- [x] Implementação e validação do primeiro marco: `docs/validation/01-interface.md`.
- [x] Infraestrutura do marco 02 escolhida pelo usuário: PostgreSQL local em Docker.
- [x] Revisão do plano 02 aprovada pelo usuário: `2026-10-20-prometeus-cadence-02-identity.md`.
- [x] Implementação do marco 02: `docs/validation/02-identity.md`.
- [x] Estudo de JEV híbrido e desenho do marco 03 aprovados pelo usuário: `../specs/2026-10-20-prometeus-cadence-03-prospecting-design.md`.
- [x] Revisão do plano 03 aprovada; execução nativa: `2026-10-20-prometeus-cadence-03-prospecting.md`.
- [x] Infraestrutura03 implementada; aceite contratual/local em `docs/validation/03-prospecting.md`. Chamadas reais e avaliação empírica pendentes de credenciais/saldo/dataset humano.
- [x] Marco03B: configuração de IA e aceite Codex ChatGPT em `docs/validation/03b-ai-routing.md`; APIs alternativas sem credenciais reais.
- [x] Desenho04 aprovado: `../specs/2026-10-20-prometeus-cadence-04-automation-ai-design.md`.
- [x] Plano04 aprovado e implementado por execução nativa; aceite local em `docs/validation/04-automation-ai.md`. Revisão final/integracão registradas no relatório04; provedores pagos não receberam novo piloto.
- [x] 05A: Meta/Twilio, inbox e cadências com aceite local; Twilio foi posteriormente retirado e substituído por OpenWA gerenciado. A conexão Meta de teste foi arquivada; o método oficial permanece disponível.
- [x] 05B: Gmail OAuth + SMTP/IMAP, inbox com threads, respostas revisadas e cadências mistas implementados; aceite local documentado no relatório05B e roteiro manual em CHANNELS-PILOT.
- [x] OpenWA e interface limpa por dois cartões/popups aceitos pelo usuário. Pareamento/readiness não substituem prova de entrega de mensagem; homologação de ida e volta permanece item do 06D quando não documentada.
- [x] Auditoria06 atualizada e roteiro corrigido em24/10/2026, com marcos06B–06E e divisão07A–07D/08A–08B.
- [x] Implementação local06A, trial de7 dias e revisão independente: `docs/validation/06-billing.md` e `docs/validation/06-billing-review.md`.
- [x] Homologação financeira06A-H com Stripe sandbox próprio: pacotes, portal, upgrade/downgrade, renovação/falha/recuperação, cancelamento/retomada e encerramento. [Evidências e limites](../../validation/06-billing-homologation.md); nenhuma cobrança live e assinatura original preservada.
- [x] Homologação da contratação inicial Essential no sandbox em25/10/2026: checkout pago, três webhooks assinados processados, plano e franquias corretos. Restante do ciclo posteriormente fechado em06A-H.
- [x]06C.1 — eventos, consultas por período e atualização contínua: [validação](../../validation/06-events-performance.md),273unitários/280integração, orçamento local medido e rascunhos/rede conferidos. Projeções maiores e consumidores finais seguem06C.2/3.
- [ ] Correção06A-V e regressão visual por área antes de avançar com aparência própria.
  Atualização26/10: correções amplas e revalidação registradas em `docs/reverse-engineering/visual-2026-10-25/REPORT.md`.100 visitas desktop/mobile,28 overlays e21 verificações localizadas não constituem aceite100%. Estados pagos/conectados da referência ficam não observados por decisão do operador. As diferenças observáveis residuais e recursos indisponíveis seguem explicitados; não iniciar o próximo marco sob alegação de paridade integral.
- [ ] Observabilidade08B: backfill idempotente dos eventos iniciais dos40 grants de piloto no ledger, conforme P3 da revisão06A. Saldos/consumo/reservas já estão preservados; não afeta cobrança Stripe.
- [ ] Correções e demais marcos, incluindo SaaS operacional completo.

## Revisão do fechamento —26/10/2026

**Atualização aprovada pelo usuário em26/10/2026.** O próximo pacote é06A-V +06A-P, seguido de06A-H; os módulos pendentes mantêm seus próprios critérios de implementação e aceite.

Quatro marcos adicionados:06A-P,06A-H,06F e06G.06B–06E,07A–07C e08A foram refinados em pacotes com aceites próprios. A UI equivalente sem paridade visual continua insuficiente; da mesma forma, aparência correta com botão sem executor não encerra a funcionalidade. O fechamento precisa das duas provas.

O usuário determinou manter os estados bloqueados da referência como não observados e esclareceu que não exige backend interno idêntico/verificado. Portanto uma área pode ter implementação própria testada sem ter reprodução remota integral comprovada; as duas classificações devem permanecer visíveis. Não alegar100% de estados desconhecidos.

Entrega26/10: entrada pública06A-P e forma lateral do assistente06A-V implementadas/testadas no escopo de [06-entry](../../validation/06-entry.md). Telefone/documentos próprios com persistência, callbacks/convites/recuperação e painel de navegação estão operacionais nos casos testados. Conversa contextual fica06F; identificação jurídica definitiva para produção e estados não observados continuam distinguidos.

06A-H e06C.1 concluídos nos respectivos escopos de [homologação financeira](../../validation/06-billing-homologation.md) e [eventos/desempenho](../../validation/06-events-performance.md). 06B.1 concluído no escopo de [contatos/importação/busca](../../validation/06-contacts-search.md), com290unitários/283integrações e conferência desktop/mobile. 06B.2 concluído no contrato próprio de [qualificação/enriquecimento/recorrência](../../validation/06-qualification-enrichment.md), com302unitários/306integrações e verificação desktop/mobile. Próximo pacote: **06IA — administração central e inteligência adaptativa de IA**, seguido de06D.1. Não reiniciar01–05 nem reabrir as decisões comerciais já tomadas.

## Direção de IA esclarecida pelo operador em26/10/2026

Apify/LLM são infraestrutura geral administrada pelo dono do SaaS. Proprietário/admin de um workspace cliente não equivale a administrador da plataforma e não deve configurar chaves, provedores, modelos, probes ou OAuth de infraestrutura. Cada cliente integra suas próprias contas de canais, como LinkedIn, Meta/WhatsApp e e-mail. A política/tela atual de IA por workspace precisa ser centralizada no06IA; chaves Apify/OpenAI/Gemini já são lidas do servidor. É uma pendência real, não uma mudança concluída por documentação.

As instruções gerais de IA serão versionadas por tarefa, com contexto/público-alvo privado da empresa e solicitação atual (ex.: clínicas odontológicas no Rio de Janeiro) como parâmetros de cada execução. O06IA precisa testar contexto ausente/conflitante, interpretação dos contratos Apify, isolamento, prompt injection, custo, abstenção e qualidade com casos verificáveis. JEV recebe um contrato de avaliação estruturado; não se pressupõe carregador nativo de skills. Não criar uma skill instalável do Codex em substituição a esse recurso do produto. O usuário determinou encerrar06B.2 antes dessa nova entrega.

### Continuidade27/10/2026 —06IA entregue

O requisito histórico acima foi implementado no escopo de [administração e inteligência central](../../validation/06-platform-ai.md): designação protegida de administradores, política/OAuth/atestação centrais, instruções internas versionadas e contexto/consumo privados.320integrações/305unitários, build/tipos e desktop/mobile validados; revisão independente com3correções verificadas. Cadastro de cliente não permite administrar provedores. Limites: sem piloto pago de acurácia, sem certificação OAuth comercial/carga pública e sem alegação de paridade integral; diferenças do contexto registradas em EV-271. Próximo pacote: **06D.1 — autoria, variantes/anexos, rascunho e agenda**.06D.2 e demais dependências permanecem na ordem existente; nenhuma compra/envio ou novo marco iniciado por esta validação.

## Barreira07A confirmada por documentação pública

Captar dados públicos via Apify e conectar uma identidade via OAuth oficial são capacidades diferentes. As APIs oficiais de convites/mensagens LinkedIn exigem habilitação específica; mensagens têm restrições de ação afirmativa do usuário e não autorizam automaticamente cadências agendadas. Antes de implementar envios, provar os escopos/capacidades concedidos e bloquear o que não for suportado. Fontes e limites em [barreiras](../../reverse-engineering/visual-2026-10-25/clone/barriers.md).

## Atualização aprovada27/10/2026 — escopo final e prioridade vigente

O operador aprovou integralmente a [auditoria e proposta de subdivisão](../specs/2026-10-27-prometeus-cadence-scope-audit.md), incluindo novas fontes Apify quando justificadas, cadeia de investigação empresarial/pessoal, jornada integrada, homologação de inteligência/fontes e divisões LinkedIn/SDR. A próxima entrega passa a ser **06B.3 — investigação da empresa e redes**, seguida de06B.4. Isso substitui as indicações históricas de “próximo06D.1” acima; não declara os novos pacotes implementados.

Separação de produto obrigatória: pesquisa noLinkedIn como fonte pode integrar a prospecção principal; o móduloLinkedIn opera a identidade/campanhas do cliente conforme permissões comprovadas; oSDR atende conversas apenas quando configurado/autorizado. Propostas de cadência não enviam mensagens, e receber resposta interrompe a cadência sem ativar automaticamente oSDR.

Cada integração terá classificação central/admin ou conta/canal do cliente. Cada superfície da UI/UX deve ligar tela/estado/controle à ação permitida, operação real, persistência, evento/métrica, feedback e teste/evidência. Incluir popups, mobile, progresso, resultado parcial, erro, limite e recuperação; nenhuma opção pode existir apenas na apresentação. Custos globais e quotas porworkspace coexistem; fonte/contato incerto não vira fato confirmado. São critérios de cada pacote e da regressão final.

A numeração preservada identifica famílias/áreas, não uma sequência estritamente crescente. O escopo completo segue06→07→08 nas grandes etapas, com dependências entre subpacotes; **08B encerra a preparação/homologação de produção pública prevista. Não há marco09 aprovado ou definido.**

### Continuidade27/10/2026 —06B.3 entregue

Investigação empresarial pública, fatos por campo/fontes, revisão/aplicação, isolamento, checkpoints e parcial implementados em [06B.3](../../validation/06b3-company-research.md). 319 unitários/337 integrações, build/tipos e27 capturas pós-revisão em1920/390/320. Cinco achados importantes corrigidos; um menor de seleção inicial do contato no lote permanece documentado com dono06B.5. Próximo: **06B.4 — identidade empresarial e tomadores de decisão**. Fontes autenticadas/qualidade live, jornada automática e produção pública mantêm os gates aprovados; nenhuma alegação de100% de estados não observados.

## Continuidade vigente —27/10/2026 · conclusão06B.4

Identidade empresarial e tomadores de decisão concluído no contrato próprio local/controlado: 330 unitários/354 integrações,17 focados,35 capturas de jornada+6 de smoke pós-revisão, cinco correções importantes e runtime restaurado. [Aceite](../../validation/06b4-company-people.md). A ordem técnica vigente está no [índice geral](2026-10-27-prometeus-cadence-master-plan.md); próximo06D.1, sem reiniciar marcos anteriores. Piloto live06IA-H, referência inacessível e produção pública mantêm gates próprios.

### Continuidade27/10/2026 —06D.1

Autoria, variantes, anexos privados de e-mail e publicação concluídos no contrato local/controlado; revisão independente com quatro correções e gates verdes. [Aceite06D.1](../../validation/06d1-message-authoring.md). Ordem atual no índice de27/10: próximo06D.2, sem iniciar automaticamente outra família nem declarar paridade/produção pública.

## Continuidade06D.2 —28/10/2026

Concluído no contrato local/controlado:comprovantes e observação revisada sem segunda fila/envio,342 unitários/383 integrações,36 capturas. Uma revisão independente corrigiu dois Important com regressões; menor de erro residual do popup→06F. [Aceite06D.2](../../validation/06d2-channel-operation.md). Próximo06B.5; piloto externo próprio, referência conectada não observada e liberação pública continuam gates explícitos, sem alegação de100%.

## Continuidade06B.5 —28/10/2026

Jornada concluída no contrato local/controlado;346unitários/402integrações/19focadas,69capturas,uma revisão independente/oito Important corrigidos. [Aceite](../../validation/06b5-prospecting-journey.md). Próximo06IA-H:homologação das fontes e inteligência; sem alteração dos marcos07/08 ou gates live/públicos. Menor herdado06B.3→06F.

## Continuidade06IA-H —28/10/2026

351/351 unitários,421/421 integrações completas,19/19 focadas, build/tipos aprovados;30casos sintéticos/60saídas e9capturas mascaradas desktop/mobile. Uma revisão independente;dois Important corrigidos com regressões RED→GREEN e um menor de arredondamento adiado para08A. Avaliador/CLI entregues localmente; piloto real de fontes/modelos permanece pendente e obrigatório para aceite empírico/publicação. [Aceite](../../validation/06iah-intelligence-homologation.md). Próximo06C.2, sem alterar o escopo07/08.

## Aceite06C.2 —29/10/2026

Dashboard/relatórios/execuções reconciliados concluídos no contrato local/controlado:355unitários/432integrações/11focadas,38capturas mascaradas e32checks desktop/mobile, uma revisão independente e dois Important corrigidos com RED→GREEN. Curadoria somente leitura do histórico real3aceites/23respostas humanas, sem novos envios/chamadas pagas. Dois menores→08A: limite93datas/DST eNULLforceSQL. [Aceite](../../validation/06c2-reconciled-reports.md). Próximo **06C.3 — notificações, preferências e resumos**. Sem aceite100% da referência nem SLO público.

### Continuidade30/10 —06C.3

Notificações, preferências e resumos concluídos local/controlado:363unitários/447integrações/15focadas;48capturas mascaradas; uma revisão independente e sete Important corrigidos numa passagem RED→GREEN. QA restaurada;0novos envios/chamadas pagas. Um menor da fixture semanal→08A; piloto de avisos externos e diferenças não observadas da referência preservados. [Aceite](../../validation/06c3-notifications.md). Próximo **06E.1 — Autenticador, sessões e administração de membros**.

### Continuidade02/11 —06E.1

Autenticador, sessões e administração de membros concluídos local/controlado: TOTP/backup BetterAuth com guardas próprias, sessão pendente bloqueada em app/API/transação, convites com assento sob lock e papéis/remoção com revisão, idempotência e último owner por trigger. 466/466 integrações;62capturas mascaradas; uma revisão independente e um Important corrigido RED→GREEN. QA L026removed/L027restored;0envios externos/chamadas pagas. Dois menores→08A; diferenças da referência (código por e-mail, confiança30dias, senha8) preservadas na matriz08A. [Aceite](../../validation/06e1-security-members.md). Próximo **06E.2 — duplicados, fusão, privacidade e ciclo dos dados**.

### Continuidade02/11 —06E.2

Duplicados, fusão, privacidade e ciclo dos dados concluídos local/controlado: varredura da base inteira por CNPJ/e-mail/telefone, fusão revisada que mantém o mais antigo, move vínculos e preserva opt-out, desfazer de7 dias só com bases intactas; retenção do texto das mensagens (30/90 dias mínimos da referência, dono, APAGAR) executada pelo runtime; exclusão com tombstone e purga de conteúdo de IA. 477/477 integrações; uma revisão independente e seis Important corrigidos RED→GREEN. QA L028removed;0envios/chamadas pagas. Exportação privada→pendência explícita. [Aceite](../../validation/06e2-data-lifecycle.md). Próximo **06F — assistente, busca, onboarding e ajuda**.

### Continuidade 02/11 — 06F.1

Busca global e assistente de ajuda e conta concluídos local/controlado:
- Ctrl K com resultados do workspace;
- painel lateral com "Pra hoje", conversa privada por usuário, IA central restrita à ajuda local e aos fatos da conta, com fallback da Central de Ajuda;
- nenhuma mutação pelo chat.

Uma revisão independente e três Important corrigidos RED→GREEN. Resposta real da IA não observada (cota da assinatura da plataforma esgotada). [Aceite](../../validation/06f1-assistant-search.md). Próximo **06F.2 — comandos revisados do assistente, onboarding e tours**.

### Continuidade 02/11 — 06F.2

Comandos revisados do assistente, passeios por área e progresso concluídos local/controlado:
- 4 propostas fechadas que abrem a revisão real de cada área, com confirmação idempotente e 0 envios;
- rascunho de resposta que preenche o compositor sem enviar;
- "Como funciona" por área e passeios vistos em Primeiros passos;
- menores 06B.3 e 06D.2 fechados.

Uma revisão independente e seis Important corrigidos RED→GREEN. **06F concluído.** [Aceite](../../validation/06f2-assistant-commands.md). Próximo **07C.1 — API, eventos e webhooks de saída**.

### Continuidade 02/11 — 07C.1a

Webhooks de saída concluídos local/controlado:
- página fiel à referência;
- eventos transacionais de lead entrou, lead qualificado e resposta humana;
- entrega assinada, com IP público fixado e retentativas limitadas a 24 h;
- atenção sem laço e justiça entre tenants.

Uma revisão independente e seis Important corrigidos RED→GREEN. [Aceite](../../validation/07c1a-webhooks.md). Próximo **07C.1b — API pública com tokens escopados**.

### Continuidade 02/11 — 07C.1b

API pública somente leitura concluída local/controlado:
- chaves escopadas, com token mostrado uma vez;
- gerar nova e revogar imediatos;
- leads e eventos com cursor retomável e limite por chave.

Uma revisão independente e quatro Important corrigidos RED→GREEN. **07C.1 concluído.** [Aceite](../../validation/07c1b-public-api.md). Próximo **07C.2**.

### Continuidade 03/11 — 07C.2a

O 07C.2 foi dividido em três pacotes. O 07C.2a, cofre de credenciais e Apollo do cliente, está concluído local/controlado:
- referência de credencial de uso único, chave conferida no Apollo e cifrada;
- buscas e automações usam a conexão revisada; revogar impede a chamada;
- chave central opcional por workspace, e `APOLLO_MAX_PAGES` prevalece.

Uma revisão independente e quatro Important corrigidos RED→GREEN. FunnelsFlow e MeetFlow seguem sem contrato oficial. [Aceite](../../validation/07c2a-connectors.md). Próximo **07C.2b — Google Sheets**.

### Continuidade 03/11 — 07C.2b

Google Sheets do cliente concluído local/controlado:
- OAuth com PKCE e escopo `drive.file`;
- planilha criada na conta do cliente, uma linha por lead, atualizada a cada evento;
- recuperação para cabeçalho alterado, planilha apagada e acesso perdido.

Uma revisão independente e quatro Important corrigidos RED→GREEN. [Aceite](../../validation/07c2b-google-sheets.md). Próximo **07C.2c — agenda**.

### Continuidade 03/11 — 07C.2c

Google Agenda do cliente concluída local/controlado:
- OAuth com PKCE;
- disponibilidade no fuso, com horários livres que descontam o ocupado no Google;
- reserva sem duplicata, reconciliada pelo id do evento;
- cancelamento idempotente.

A página não entra no grid de Apps (a referência não tem esse cartão); quem vai usar a agenda é o 07B.3. Uma revisão independente encontrou três Important, corrigidos RED→GREEN. Com isso, o 07C.2 está fechado. [Aceite](../../validation/07c2c-google-calendar.md). Próximo **07A.0 — viabilidade do LinkedIn**.
