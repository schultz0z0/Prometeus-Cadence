# 07A.3b — Cadência pós-aceite e templates LinkedIn: plano de execução

03/11/2026. Segunda parte do [07A.3](2026-10-27-prometeus-cadence-07a3-linkedin-conversations.md), sobre o 07A.2 (campanhas) e o 07A.3a (conversas). A Unipile fica simulada nos testes.

## Decisão de desenho

A referência (EV-236) apresenta as cadências do LinkedIn como "Cadências para quem aceitou seu convite", com link para a campanha. Os passos LinkedIn da régua geral existem só no rascunho; a publicação os bloqueia (`CHANNEL_UNAVAILABLE`).

Ligar o canal LinkedIn ao motor de publicação e despacho do e-mail e do WhatsApp mexeria no núcleo em produção. Por isso a cadência pós-aceite fica **própria do LinkedIn**:
- ligada a uma campanha;
- executada pela lane `linkedin`;
- sujeita às mesmas travas do 07A.2 e do 07A.3a.

A régua geral continua sem passo LinkedIn executável (limite registrado).

## Unipile (SRC-014)

- **Conversa existente:** `POST /api/v1/chats/{chat_id}/messages` (multipart `text`).
- **Conversa nova com uma relação:** `POST /api/v1/chats` (multipart `account_id`, `text`, `attendees_ids`). Devolve `chat_id` e `message_id`.

## Regras

- **Templates:** nome, tipo (convite até 300 caracteres, mensagem até 8.000) e texto com `{nome}`, `{empresa}`, `{cargo}`, `{setor}` e `{prova}`. Têm revisão e podem ser arquivados. Servem para a nota do convite e para os passos.
- **Cadência:**
  - nome, campanha e de 1 a 10 passos `{dias, texto}`; o primeiro conta a partir do aceite e os seguintes a partir do passo anterior;
  - o rascunho é editável;
  - só owner/admin ativa, pausa, retoma e arquiva;
  - uma cadência ativa por campanha.
- **Modo, decidido a cada envio pela trava:**
  - **automático** só com `sendMessage: automatic` (que libera `scheduledMessage`);
  - **assistido** com `sendMessage: assisted`: o passo vira um rascunho, a pessoa envia pela conversa (revisão de 60 s do 07A.3a) e só então a cadência avança;
  - sem envio de mensagens, a ativação é bloqueada.
- **Inscrição:**
  - entra quem aceitou na campanha, não respondeu e não pediu opt-out;
  - para a cadência: resposta recebida, opt-out, pausa ou arquivo da cadência, conta revogada (a campanha fica concluída);
  - um dado do perfil ausente no texto para a cadência daquela pessoa, sem inventar.
- **Envio automático:**
  - até 30 mensagens de cadência por dia de Brasília por membro LinkedIn;
  - 5 min entre envios, em dias úteis das 9h às 18h;
  - um registro por passo e pessoa (nunca repete);
  - antes da chamada, relê a cadência, a pessoa, a conta e a trava;
  - sem chave da Unipile, nada sai e nada fica incerto;
  - um envio incerto para a cadência daquela pessoa, sem reenvio;
  - a conversa nova vira thread do 07A.3a.
- **Conversa sem thread:** a resposta revisada do 07A.3a passa a aceitar a pessoa (começa a conversa com quem já é conexão).

## Fora do escopo

- **Régua geral:** passo LinkedIn na régua geral (publicação e despacho do 06D).
- **Aprovações (07A.3c).**
- **IA:** "trecho da IA" e "Montar filtros com IA".
