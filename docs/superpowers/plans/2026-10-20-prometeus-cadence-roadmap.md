# Prometeus Cadence — roteiro de implementação

Especificação aprovada: `docs/superpowers/specs/2026-10-20-prometeus-cadence-design.md`.

O produto exige vários subsistemas. O plano executável abaixo cobre a primeira entrega independente; os seguintes serão detalhados sobre interfaces e decisões verificadas, sem prometer integrações a partir de mocks.

**Revisão vigente:26/10/2026.** O alvo é a réplica visual, dos fluxos e das funcionalidades de produto; o usuário não exige comprovar uma implementação interna idêntica ao backend privado da referência. A implementação própria continua sujeita a testes reais. Regras não observadas recebem contrato explícito e classificação, sem bloquear todo o roteiro nem serem apresentadas como verificadas no concorrente. Detalhamento, sequência e critérios em [Fechamento de paridade](2026-10-26-prometeus-cadence-parity-closure.md).

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
| 06B | Contatos, fontes, qualificação, enriquecimento e fechamento dos wizards de automação | 03–04 + unidades comerciais do06A |06B.1 base/importação/busca/IA;06B.2 módulos/decisores/cache/crédito/recorrência; fluxo até resultado persistido e recuperação |
| 06C | Eventos, desempenho, dashboard, relatórios, execuções e notificações | 03–06A; projeções consomem eventos de06B/06D |06C.1 eventos/latência/atualização contínua;06C.2 projeções reconciliadas;06C.3 feed/som/avisos/resumos reais; nenhum dado demonstrativo apresentado como operação |
| 06D | Autoria, publicação, canais e inbox | 05,06B e OpenWA |06D.1 modelos/variantes/anexos/rascunho/agenda;06D.2 entrega/resposta/opt-out e telemetria suportada; reinício sem duplicação e piloto próprio autorizado |
| 06E | Segurança, privacidade e ciclo de dados/membros | 02,06A-P e06A |06E.1 TOTP/dispositivos/convites/permissões;06E.2 mesclagem/retenção/exportação/exclusão reais, conteúdo removido fora da IA, isolamento |
| 06F · novo | Experiência transversal, assistente, busca, onboarding e ajudas | 03B–04,06C e comandos dos módulos disponíveis | Painel conversacional com contexto/permissão, propostas revisadas, busca no escopo observado, tours/checklist e destinos reais; aparência e operação verificadas separadamente |
| 07A | LinkedIn completo em dois pacotes | 06A,06B,06D,06E e prova do adaptador |07A.1 conexão/público/convites/aceites;07A.2 pessoas/pipeline/enriquecimento/cadência pós-aceite/aprovações e limites |
| 07B | SDR configurável e depois operacional | 06D,06E,06F e operações reais de07C.1/07C.2 |07B.1 configuração/propostas/revisão;07B.2 conversa/agenda/CRM/follow-up/quotas/parada/handoff em contas próprias; não depende de provar o backend original |
| 07C | Integrações, API/eventos, agenda e MCP em três pacotes | 02,06E e eventos/comandos do domínio |07C.1 API/outbox/webhooks/contratos de agenda e CRM;07C.2 adaptadores por workspace e fluxos externos;07C.3 MCP com escopos/confirmação/revogação |
| 06G · novo | Catálogo comercial completo e capacidade adicional | 06A-H e aceite dos recursos vendidos;07A/07B quando incluídos | Anual/cupom conforme catálogo-alvo, caixas/números/assentos com vigência e quotas; consumo pré-pago preservado; módulos pendentes continuam fora de venda |
| 07D | Descoberta e eventual entrega de Lead Scoring / Hot Now | Eventos de 06C/07B e confirmação da oferta atual | A documentação pública usa planos antigos; confirmar primeiro. Depois, eventos, decay, tiers e replay com fixture |
| 08A | Regressão final visual e funcional do inventário-alvo já exigida em cada marco | 06A–07C, incluindo06F/06G;07D conforme descoberta | Jornadas entre módulos, desktop/tablet/mobile, todos os estados catalogados, foco/teclado/tema/texto; contratos próprios testados e limites de observação explícitos |
| 08B | Operação e produção | 08A + contas próprias habilitadas | Backup/restauração, observabilidade, orçamento de latência, recuperação de provedores, isolamento, deploy/rollback e teste real autorizado |

Os IDs preservam o histórico, não impõem a ordem numérica de execução. Ordem recomendada:06A-V→06A-P→06A-H→06C.1→06B→06D→06C.2/06C.3→06E→06F→07C.1/07C.2→07A→07B→07C.3→06G→08A→08B.07D é condicional. Preparar contratos independentes antes é permitido; dependências de segurança, autorização e operação real não são removidas. O SDR usa agenda/CRM já operacionais, não apenas interfaces ou tipos preparados.

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

06A-H e06C.1 concluídos nos respectivos escopos de [homologação financeira](../../validation/06-billing-homologation.md) e [eventos/desempenho](../../validation/06-events-performance.md). 06B.1 concluído no escopo de [contatos/importação/busca](../../validation/06-contacts-search.md), com290unitários/283integrações e conferência desktop/mobile. Próximo pacote: **06B.2 — qualificação, enriquecimento e recorrência**, seguindo o [fechamento revisado](2026-10-26-prometeus-cadence-parity-closure.md), sem reiniciar01–05 nem reabrir as decisões comerciais já tomadas.
