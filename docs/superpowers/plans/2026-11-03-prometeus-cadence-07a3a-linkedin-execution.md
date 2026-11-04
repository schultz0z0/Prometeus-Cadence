# 07A.3a — Pessoas, pipeline e conversas LinkedIn: plano de execução

03/11/2026. O [plano de tarefas do 07A.3](2026-10-27-prometeus-cadence-07a3-linkedin-conversations.md) junta três frentes. Como no 07C.2, ele é dividido em partes:
- **07A.3a (este):** pessoas, pipeline, conversas sincronizadas e resposta revisada.
- **07A.3b:** cadência pós-aceite (passos LinkedIn hoje só no rascunho da régua) e templates LinkedIn.
- **07A.3c:** aprovações de comentários, que dependem de um passo de comentário com IA.

A Unipile fica simulada nos testes.

## Unipile (documentação pública, SRC-014 e SRC-015)

- **Mensagens novas:** `GET /api/v1/messages?account_id=&after=` (id, chat_id, text, timestamp, is_sender, sender_id, paginado). A Unipile recomenda deduplicar pelo id.
- **Chat:** `GET /api/v1/chats/{id}`, com `attendee_provider_id`.
- **Resposta:** `POST /api/v1/chats/{chat_id}/messages` em `multipart/form-data` com `text`.

## Desenho

- **Pessoas (`/linkedin/people`):** as pessoas das campanhas, com etapa, campanha, empresa e última atividade. Filtros por etapa, campanha e nome.
- **Pipeline (`/linkedin/pipeline`):** colunas da referência: Na fila, Aquecida, Convidada, Aceitou, Respondeu.
  - "Aquecida" fica vazia com o motivo (aquecimento indisponível).
  - O único movimento manual é entre Aceitou e Respondeu (resposta por fora do LinkedIn), com revisão e `requestId`.
- **Sincronização:** o worker lê as mensagens novas a cada 15 min, até 100 por rodada, com cursor por tempo e 1 h de folga.
  - Só guarda conversas com pessoas das campanhas desta conta (o chat desconhecido é resolvido uma vez e fica em cache).
  - A deduplicação é pelo id remoto.
  - Uma mensagem recebida marca a pessoa como "respondeu", o que impede envios futuros da cadência (07A.3b).
- **Resposta:**
  - Revisar emite um token de 60 s, ligado ao usuário e ao texto.
  - Confirmar exige o mesmo usuário, o mesmo texto e o token dentro do prazo (ação humana recente, como pede o modo assistido). Antes da chamada, o servidor relê a trava, a conta e o opt-out.
  - O mesmo `requestId` não reenvia. Um envio incerto não é repetido.
  - A mensagem enviada entra com o id remoto, então a sincronização não a duplica.
  - Não existe envio agendado neste pacote.
- **"Não contatar mais":** grava o opt-out na pessoa e tira da fila quem ainda não foi convidado. Uma resposta confirmada depois do opt-out envia 0.

## Fora do escopo

- **Pacotes seguintes:** cadência pós-aceite e templates LinkedIn (07A.3b); aprovações (07A.3c). As páginas continuam com o vazio da referência e o aviso de indisponível.
- **Retenção:** o expurgo de texto de mensagens ainda não cobre as mensagens do LinkedIn (limite registrado).
