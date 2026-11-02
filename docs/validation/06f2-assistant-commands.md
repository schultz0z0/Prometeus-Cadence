# 06F.2 — Comandos revisados do assistente, passeios e progresso

Data: 02/11/2026. Estado: concluído local/controlado após revisão independente ([revisão](06f2-assistant-commands-review.md)). [Plano do pacote](../superpowers/plans/2026-11-02-prometeus-cadence-06f2-assistant-commands.md). Fecha o 06F junto com o [06F.1](06f1-assistant-search.md). Não é aceite de paridade 100% nem de produção pública.

## Contrato entregue

- **Propostas do assistente.** A IA pode sugerir uma de 4 ações fechadas. A proposta só é gravada quando o tipo está na allowlist, o payload passa por Zod e as listas ou conversas citadas vêm do catálogo do próprio workspace. O resumo é escrito pelo servidor, nunca pelo modelo.

  | Ação | Revisão usada | Ao confirmar |
  |---|---|---|
  | Montar público e automações pausadas | planejamento do 04 (`audience_plan`) | cria a análise; a lista e as automações pausadas nascem na seleção em `/automations/new/ai` |
  | Gerar opções de cadência | planejamento (`cadence_options`) | cria a análise; o rascunho nasce na seleção em `/cadences/new/ai` |
  | Qualificar uma lista | job de qualificação | cria o job em `/executions/:id` |
  | Rascunho de resposta | token próprio | guarda o rascunho e abre a conversa com o compositor preenchido |

  Nenhuma das 4 ações ativa, publica ou envia algo.
- **Revisão no chat.** O card mostra Revisar, Cancelar, Confirmar e Abrir.
  - A revisão vem do serviço da área, com bloqueios, avisos e uso estimado.
  - O servidor reconstrói a entrada a partir da proposta gravada; o cliente só devolve o token.
  - Proposta vencida (30 min), cancelada, de outro usuário ou com base alterada recebe 409/404.
  - Confirmar duas vezes com o mesmo id devolve a mesma entidade; um segundo id recebe 409.
- **Permissão.** A permissão do papel é exigida antes de revisar e de confirmar. A confirmação no chat não amplia a autoridade.
- **Passeios por área.**
  - "Como funciona" no topo abre o passeio da área atual: 10 passeios próprios, o geral com os 10 passos de antes.
  - Os cards "Conheça cada tela" têm "Como funciona" e "Abrir".
  - Concluir um passeio grava `onboarding_progress`, por usuário e workspace, com lista fechada, e o card mostra "Passeio visto".
  - Os passos operacionais do checklist continuam derivados de fatos.
- **Menores herdados.**
  - 06B.3: o lote da investigação abre a empresa do `?leadId`.
  - 06D.2: o polling bem-sucedido limpa só o erro de carregamento do popup de comprovantes; o erro da ação "Atualizar e registrar verificação" continua visível.
- **Ajuda.** "Qualifica a lista…" agora encontra o artigo do Qualificador (palavra-chave por radical).

## Validação executada

- **Unitários:** 7/7 no arquivo do 06F (allowlist e catálogo, permissões, passeios e menores).
- **Integração focada:** 16/16, sendo 9 do 06F.1, 5 novos e 2 da revisão (recuperação após vencimento sem segundo job; nomes longos, lista acima de 500, texto de contato só em perguntas de resposta e proposta inválida descartada sozinha).
  - qualificar lista: base alterada recebe 409, confirmação dupla gera 1 job e 0 envios;
  - injeção e referências de outro workspace não viram proposta, e nada muda;
  - dono, vencimento, cancelamento e membro removido;
  - rascunho de resposta: um rascunho, leitura só pelo dono, 0 envios, catálogo com a última mensagem recebida;
  - passeios com lista fechada e contrato HTTP.
- **Suítes completas:** 378/378 unitários, 493/493 integrações, build e tipos exit 0, `git diff --check` limpo.
- **RED:**
  - sem a migração 094, a suíte falhou;
  - os menores falharam com o código anterior;
  - a avaliação múltipla de `(fn()).*` foi pega pelo teste de cancelamento e corrigida para `SELECT * FROM fn()`.

## QA no navegador

- **Conta:** descartável `[RE] QA Comandos`, com dois leads `[RE]`.
- **Fixture de proposta:** com a IA central sem cota, a proposta foi criada pela mesma função SQL que o serviço usa. É uma fixture controlada, não uma resposta da IA.
- **Card de proposta:** "Revisar" mostrou os avisos reais da qualificação, sem bloqueios. Cancelei sem confirmar, para não iniciar uma execução externa.
- **Passeio:** o de Contatos foi concluído e gravou o progresso, e o selo apareceu em Primeiros passos.
- **Telas pequenas:** sem overflow em 320 px.

Capturas em [evidence](evidence/06f2-assistant-commands/).

## QA, runtime e custos

- **L-030 removed:** usuário, workspace `[RE] QA Comandos`, linhas de app, membro, sessão, conta, pedido e organização removidos por IDs exatos, sem resíduo.
- **Migrações:** 094/094a aplicadas localmente.
- **Runtime:** inalterado.
- **Custo externo:** zero envios; nenhuma confirmação real na QA.
- **Entrega:** sem merge, push ou deploy.

## Limites

- **IA real:** não foi observada; nenhuma proposta vinda do modelo ao vivo.
- **Confirmação na QA:** não foi feita no navegador, para não disparar a execução externa. A confirmação está coberta pela integração.
- **Rascunho de resposta:** não houve QA visual porque o workspace de QA não tem canal conectado. O preenchimento do compositor está coberto por código e pela integração do serviço.
- **Referência:** o CadenceFlow não mostrou comandos executados pelo chat. A página MCP dela anuncia pedidos equivalentes ("Leads novos toda semana", "O que responder para quem respondeu"). Os cards de proposta são desenho próprio.
