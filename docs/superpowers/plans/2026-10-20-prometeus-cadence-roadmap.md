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
| 06 | Assinatura, checkout, adicionais, renovação e cobrança por uso | 02 e contratos de uso | Webhooks autenticados, teste/renovação/cancelamento e quota servidor |
| 07 | LinkedIn, SDR e integrações CRM/planilhas/API/MCP | Base de execução e permissões | Conectores próprios e aprovações por escopo, sem depender do concorrente |
| 08 | Paridade, operação e produção | 01–07 | Comparação visual/funcional, backup/restauração, observabilidade e recuperação |

Os marcos de engenharia 02–06 podem exigir pequenos ajustes de sequência quando uma credencial estiver disponível; nenhuma dependência de segurança ou autorização pode ser removida para adiantar o trabalho.

## Decisões já fixadas

- Experiência principal por formulários, prévias, propostas e botões de confirmação.
- Fidelidade à estrutura observada, incluindo canvas, filtros, onboarding e estados vazios.
- Não assumir Apify, banco, fila ou modelo do concorrente sem evidência.
- Conta comercial própria e marca de trabalho Prometeus Cadence.
- Distinguir ambiente demonstrativo de integração real em toda entrega.
- Antes de novas recomendações de skills, plugins, ferramentas ou MCPs, concluir consulta autenticada ao O Setup. A tentativa desta sessão retornou 401.

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
- [ ] Plano04 escrito para revisão: `2026-10-20-prometeus-cadence-04-automation-ai.md`; execução nativa preservada.
- [ ] Demais marcos, incluindo SaaS operacional completo.
