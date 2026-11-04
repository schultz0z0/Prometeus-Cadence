# 07A.3b — Cadência pós-aceite e templates do LinkedIn

Data: 04/11/2026. Estado: concluído local/controlado, com a Unipile simulada nos testes ([revisão](07a3b-linkedin-sequences-review.md), [plano de execução](../superpowers/plans/2026-11-03-prometeus-cadence-07a3b-linkedin-execution.md)).

Nenhuma mensagem real saiu, e nenhuma chamada foi feita à Unipile ou ao LinkedIn. Falta o 07A.3c (aprovações de comentários).

## O que o cliente consegue fazer

- **`/linkedin/templates`:**
  - cria, edita e arquiva textos de convite (até 300 caracteres) e de mensagem (até 8000), com as variáveis {nome}, {empresa}, {cargo}, {setor} e {prova};
  - tem busca e as visões em lista ou cards;
  - os filtros Email e WhatsApp levam para `/templates`, onde ficam esses textos.
- **Campanha:** o editor ganhou "Usar um template de convite", que preenche a nota.
- **`/linkedin/cadences`:**
  - cada campanha pode ter uma cadência pós-aceite de 1 a 10 passos, com os dias depois do aceite ou do passo anterior, e "Usar um template" em cada passo;
  - há busca, status, ordenação e visões em lista ou cards;
  - os contadores mostram quem está em andamento, com rascunho, concluído, respondeu ou saiu;
  - só dono ou administrador ativa, pausa, retoma ou arquiva; uma cadência ativada não muda mais.
- **Modo:**
  - com o envio automático habilitado, os passos saem sozinhos;
  - com o envio assistido, cada passo vira um rascunho;
  - sem envio, a cadência pode ser preparada, mas não ativada.
  - A página diz qual modo está valendo.
- **`/linkedin/people`:**
  - quem aceitou e ainda não tem conversa ganha "Mensagem";
  - quem tem rascunho da cadência ganha "Revisar rascunho";
  - a mensagem revisada e confirmada em até 1 minuto começa a conversa com a conexão, e só então a cadência segue.

## Regras executáveis

- **Envio:**
  - até 30 mensagens de cadência por dia por membro do LinkedIn, com 5 minutos entre elas;
  - só em dias úteis, das 9h às 18h de Brasília;
  - um envio incerto nunca é repetido, e a pessoa sai da cadência.
- **Parada:**
  - a cadência para quando a pessoa responde, inclusive pela marca manual "Respondeu" (104a);
  - também para no opt-out e quando a cadência é arquivada;
  - também para quando a campanha termina ou é cancelada (104a);
  - a campanha pausada segura a cadência (104a);
  - a conta revogada não envia.
- **Fatos:** se faltar no perfil um dado usado no texto, a pessoa sai da cadência em vez de receber um texto inventado.
- **Reteste:** se falhar logo antes do envio, a pessoa volta em 15 minutos e não trava as outras contas (104a).
- **Arquivamento:** arquivar durante um envio não perde o registro da mensagem entregue (104a).

## Diferenças em relação ao plano de tarefas

- **Motor próprio:** a cadência é específica do LinkedIn, por campanha, e não usa o motor geral de cadências. A publicação geral continua recusando passos LINKEDIN.
- **Migrações:** 104 e 104a.
- **Métricas:** a referência mostra um seletor de período nas métricas da cadência; aqui ficam só os contadores, sem período.

## Validação executada

- **Unitários:** 4/4 no arquivo do pacote.
- **Integração focada:** 11/11, rodada duas vezes; 4 destes testes vieram dos achados da revisão. Cobrem:
  - templates (revisão, tipo, workspace);
  - ativação (trava, papel, uma por campanha);
  - envio automático (o 1º passo começa o chat, o 2º espera seus dias, fato faltando);
  - paradas por resposta, opt-out, pausa e conta revogada, e o incerto sem reenvio;
  - 30 por dia, 5 minutos e o horário;
  - envio assistido, com o rascunho revisado e enviado;
  - HTTP e SQL (401, 422, `no-store`, 42501).
- **Teste corrigido:** a ordem dos dois primeiros envios dependia de um id aleatório; o teste passou a aceitar qualquer ordem.
- **Suítes completas:** 578/578 de integração e 412/412 unitários. Build e tipos com exit 0, e `git diff --check` limpo.

## QA no navegador

Conta descartável `[RE] QA Cadencias LinkedIn`. A habilitação (envio assistido), a conta pronta, a campanha ativa e três pessoas foram fixtures locais. O rascunho foi produzido chamando as funções reais do worker com um horário dentro da janela, porque o QA rodou à 0h de Brasília.
- **Templates:** criar, editar, o tipo convite e o filtro Email ([captura](evidence/07a3b-linkedin-sequences/local-linkedin-templates.jpg)).
- **Cadência:** criada com template e dois passos, depois ativada ([captura](evidence/07a3b-linkedin-sequences/local-linkedin-cadence-active.jpg)) e pausada com os contadores ([captura](evidence/07a3b-linkedin-sequences/local-linkedin-cadence-paused.jpg)).
- **Pessoas:** "Revisar rascunho" e "Mensagem" ([captura](evidence/07a3b-linkedin-sequences/local-linkedin-people-draft.jpg)). A revisão sem chave mostra o erro de configuração e mantém o texto ([captura](evidence/07a3b-linkedin-sequences/local-linkedin-draft-not-configured.jpg)).
- **Campanha:** o seletor lista só templates de convite e preenche a nota.
- **Limpeza (L-040 removed):** resíduo 0.

## Limites

- **Contrato real da Unipile:** `POST /chats` (`account_id`, `attendees_ids`, `text`) e `chat_id`/`message_id` da resposta vêm da documentação pública (SRC-014) e precisam ser confirmados com a conta de teste.
- **Referência:** mostra Cadências e Templates do LinkedIn só vazios. A lista, os cards e o editor seguem o padrão visual existente e ficam classificados como não observados.
- **Cobrança:** mensagens de cadência não consomem créditos; a decisão de cobrança continua com o usuário.
- **Sem paridade completa:** aprovações (07A.3c) pendentes. Esta entrega não declara paridade.
- **Entrega:** sem push, merge ou deploy.
