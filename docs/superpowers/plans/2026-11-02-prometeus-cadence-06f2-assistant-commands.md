# 06F.2 — Comandos revisados do assistente, tours e progresso

Data: 02/11/2026. Segundo pacote do [plano 06F](2026-10-27-prometeus-cadence-06f-assistant-experience.md); o 06F.1 entregou a busca e o assistente de ajuda e conta.

## Escopo

1. **Propostas do assistente.** A saída da IA pode trazer uma proposta, numa allowlist fechada de 4 tipos. Ela passa por Zod e só referencia listas e conversas do catálogo fornecido. A proposta é gravada em `assistant_proposal`, com dono, prazo de 30 minutos e estado (`proposed`, `confirmed`, `cancelled`).

   | Comando | Serviço existente | Destino real |
   |---|---|---|
   | `create-audience-automation` | `preparePlanning`/`confirmPlanning` (audience_plan); a lista e as automações pausadas são criadas pela seleção do 04 no assistente de automação | `/automations/new/ai?job=` |
   | `create-cadence` | `preparePlanning`/`confirmPlanning` (cadence_options); o rascunho nasce na seleção | `/cadences/new/ai?job=` |
   | `qualify-list` | `prepareJob`/`confirmJob` (qualification) | `/executions/:job` |
   | `draft-reply` | Sem serviço existente: a confirmação guarda o rascunho revisado; o envio continua na revisão da conversa | `/messages/{canal}?conversation=&draft=` |

2. **HTTP.** `POST /api/assistant/:id/{prepare,confirm,cancel}` e `GET /api/assistant/:id/draft`.
   - `prepare` revalida o dono, o prazo, a permissão do papel (`assistantActionAllowed`) e a base, e devolve o `Reviewed` do serviço de baixo.
   - `confirm` com o mesmo `requestId` é idempotente: devolve a mesma entidade. Proposta vencida ou base alterada recebe 409.
3. **Onboarding e tours.**
   - Manifesto de passeios por rota.
   - "Como funciona" no topo abre o passeio da área atual, e os cards "Conheça cada tela" abrem o passeio da tela.
   - Concluir o passeio grava `onboarding_progress` (marcação explícita de aprendizado, por usuário e workspace). Os passos operacionais continuam derivados de fatos.
4. **Menores herdados.**
   - 06B.3: o lote de pesquisa respeita `?leadId`.
   - 06D.2: o polling bem-sucedido limpa o erro inicial do popup de comprovantes.

## Testes

- **Unitário:** allowlist e esquemas por comando, permissão por papel e manifesto de passeios.
- **Integração:**
  - proposta só com IDs do catálogo; injeção não cria proposta fora da allowlist;
  - `prepare` por papel sem permissão recebe 403;
  - proposta vencida ou base alterada recebe 409;
  - confirmar 2 vezes cria 1 job ou 1 rascunho e 0 envios;
  - `cancel` impede `confirm`;
  - proposta de outro usuário recebe 404;
  - progresso de passeio por usuário com allowlist;
  - contrato HTTP.

## Fora do escopo

Ativar automações, publicar cadências ou enviar mensagens pelo chat: cada uma continua no seu fluxo revisado.
