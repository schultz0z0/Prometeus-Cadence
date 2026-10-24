# Prometeus Cadence — roteiro de implementação

Especificação aprovada: `docs/superpowers/specs/2026-10-20-prometeus-cadence-design.md`.

O produto exige vários subsistemas. O plano executável abaixo cobre a primeira entrega independente; os seguintes serão detalhados sobre interfaces e decisões verificadas, sem prometer integrações a partir de mocks.

| Ordem | Entrega independente | Dependência | Aceite |
| --- | --- | --- | --- |
| 01 | Interface fiel, dados demonstrativos persistentes no navegador e fluxos completos de revisão/rascunho | Levantamento concluído | Plano detalhado `2026-10-20-prometeus-cadence-01-interface.md` |
| 02 | Cadastro, login, workspace, papéis, banco e migrações | Contratos de domínio do 01 | Dois clientes isolados, sessão real e dados persistentes no servidor |
| 03 | Adaptadores de geração, extração e qualificação; jobs e uso | 02 + escolha/credenciais dos provedores | Prospecção real por fonte, cancelamento, deduplicação e ledger |
| 03B | Roteamento configurável, LLM convencional completa e JEV acompanhado | 03 | Política isolada por workspace, teste confirmado e três inferências Codex reais |
| 04 | Contexto e propostas de IA reais, criação atômica e scheduler | 02 e 03 | Nenhuma sugestão cria dados; confirmação idempotente; execução recorrente |
| 05 | E-mail, WhatsApp, cadências em produção e inbox | 02–04 + credenciais | Limites agregados, resposta/opt-out, falhas, retries e reconciliação |
| 06A | Auditoria atualizada + assinatura Stripe em teste, catálogo, renovação e pacotes de consumo pré-pagos | 02 e contratos de uso | Catálogo versionado, eventos autenticados/idempotentes, quota no servidor, nenhuma concessão por retorno do checkout |
| 06B | Correção de paridade de contatos, fontes, qualificação e enriquecimento | 03–04 + unidades comerciais do 06A | Filtros/importação completos, enriquecimento útil com crédito único/cache, verificação de e-mail/WhatsApp corretamente identificada |
| 06C | Correção de dashboard, relatórios, execuções, notificações e atualização contínua | 03–06A | Remover valores sintéticos do modo autenticado; indicadores reconciliados; avisos reais agrupados e limitados; rascunhos preservados |
| 06D | Fechamento de paridade de canais, inbox e cadências | 05 + OpenWA | Fluxo completo de revisão, histórico e teste; envio/recibo/resposta reais autorizados; recuperação sem reenvio incerto |
| 06E | Segurança, privacidade e ciclo de dados/membros | 02 + 06A | TOTP/dispositivos, permissões, retenção com tombstones fora da IA, mesclagem revisada e isolamento entre clientes |
| 07A | LinkedIn completo | 06A, 06D e adaptador próprio | Campanha de convites separada da cadência pós-aceite; público, fila, expiração, enriquecimento, aprovações públicas e limites |
| 07B | Agente SDR completo | 06A, 06D, 06E e contratos 07C | Revisão inicial, quota ponderada, score, agenda, follow-up, parada por conversa e passagem para humano |
| 07C | CRM, Sheets, Apollo por cliente, API, webhooks de saída e MCP | 02, 06E e eventos do domínio | Credenciais próprias, mapeamento, outbox/retry, HMAC, OAuth e permissões por ferramenta; revogação verificável |
| 07D | Descoberta e eventual entrega de Lead Scoring / Hot Now | Eventos de 06C/07B e confirmação da oferta atual | A documentação pública usa planos antigos; confirmar primeiro. Depois, eventos, decay, tiers e replay com fixture |
| 08A | Matriz final de paridade visual, estados, fluxos e acessibilidade | 06A–07C; 07D conforme descoberta | Desktop/tablet/mobile, vazio/cheio/erro/loading/bloqueio, foco/teclado, tema/tamanho do texto e divergências classificadas |
| 08B | Operação e produção | 08A + contas próprias habilitadas | Backup/restauração, observabilidade, orçamento de latência, recuperação de provedores, isolamento, deploy/rollback e teste real autorizado |

Os marcos de engenharia podem exigir pequenos ajustes de sequência quando uma credencial estiver disponível; nenhuma dependência de segurança ou autorização pode ser removida para adiantar o trabalho. Contratos necessários ao SDR (agenda/CRM) podem ser preparados no 07C antes da homologação do 07B, sem simular integração como concluída.

## Revisão por auditoria de 24/10/2026

O usuário autorizou expressamente novos marcos corretivos para áreas anteriores. A numeração original 01–05 é preservada como histórico de entregas; 06B–06E fecham lacunas de paridade encontradas, sem apagar os aceites já registrados.

Acervo atualizado: `docs/reverse-engineering/reaudit-2026-10-24/`. São 29 áreas catalogadas, 84 evidências, 18 regras observadas/ofertadas e inspeção de 26 arquivos locais no baseline `a63161f`. Consulte `clone/parity.md`, `findings.md` e `inventory/coverage.md`. Estados pagos/conectados e ações externas da referência não foram exercitados; ainda não existe evidência de paridade100%.

Principais correções verificadas no código: painéis do dashboard com dados fixos/sintéticos; enriquecimento de decisores só em prévia; relatório de performance simplificado; notificações apenas como preferências; privacidade/mesclagem/MCP/webhooks em telas provisórias. LinkedIn e SDR ainda são apresentações. Os adaptadores reais e as reservas de uso já construídos serão reaproveitados. O nome `useDemo` sozinho não prova persistência falsa: o modo autenticado injeta o repositório do workspace.

O catálogo atual da referência é Essential R$397/mês e Pro R$897/mês; opção anual com20% de desconto. O usuário permitiu reproduzir os planos. Há uma divergência comercial intencional: adicionais da referência são recorrentes, enquanto o usuário escolheu pacotes de consumo pré-pagos. Capacidade (assentos/caixas/números) não deve virar direito vitalício por engano. O desenho06A deve separar essas unidades e não habilitar cobrança real.

Diferenças preservadas: marca própria; OpenWA gerenciado em lugar de Twilio/Z-API; limites iniciais20/5; nenhuma promessa de imunidade a bloqueio; IA configurável; credenciais e infraestrutura próprias. Não copiar textos/modelos proprietários, métricas promocionais nem benefícios de terceiros como se fossem fornecidos pelo Prometeus.

Critério global: cada área só fecha com interface, regra, persistência, permissão, execução em segundo plano, falha/reconciliação e aceite verificável. A matriz distingue observação, documentação antiga, inferência, implementação e homologação real. O relatório desta rodada está em `docs/validation/06-reaudit.md`.

## Decisões já fixadas

- Experiência principal por formulários, prévias, propostas e botões de confirmação.
- Fidelidade à estrutura observada, incluindo canvas, filtros, onboarding e estados vazios.
- Não assumir Apify, banco, fila ou modelo do concorrente sem evidência.
- Conta comercial própria e marca de trabalho Prometeus Cadence.
- Distinguir ambiente demonstrativo de integração real em toda entrega.
- A exigência anterior de consulta ao O Setup foi dispensada explicitamente pelo usuário nesta conversa.

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
- [ ] Implementação e homologação comercial06A.
- [ ] Correções e demais marcos, incluindo SaaS operacional completo.
