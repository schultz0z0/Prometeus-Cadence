# 07A.3c — Aprovações de comentários no LinkedIn: plano de execução

04/11/2026. Terceira e última parte do [07A.3](2026-10-27-prometeus-cadence-07a3-linkedin-conversations.md), sobre a cadência pós-aceite do 07A.3b. A Unipile e a IA ficam simuladas nos testes.

## Decisão de desenho

A referência (EV-235, EV-049) tem a página "Comentários que a IA escreve, você aprova":
- "Quando um passo da campanha comenta num post, o texto para aqui antes de sair: você lê, ajusta e aprova."
- "É a única ação pública do módulo, por isso ninguém publica sem a sua palavra."

A referência só mostra a página vazia. Não mostra onde o passo de comentário é configurado. O aquecimento da campanha (EV-241) é "visitar o perfil e curtir um post", sem comentário.

Por isso o comentário entra como **um tipo de passo da cadência pós-aceite do 07A.3b**: "Comentar o post mais recente". Assim, o "passo da campanha" é literal e reaproveita as travas, as paradas e o espaçamento que já existem. Quando o passo vence:
- o worker procura o post recente da pessoa;
- a IA central escreve o comentário;
- o texto vai para Aprovações;
- só depois da aprovação o comentário é publicado.

Isso vale mesmo com o envio automático habilitado.

Fora do escopo: o executor do aquecimento (visitar e curtir), que continua bloqueado no editor da campanha, e a coluna "Aquecida" do pipeline.

## Unipile (SRC-016)

- **Posts da pessoa:** `GET /api/v1/users/{provider_id}/posts?account_id=…&limit=5`. Devolve `items[]` com `social_id`, `text`, `parsed_datetime`, `share_url`, `is_repost` e `permissions.can_post_comments`.
- **Comentar:** `POST /api/v1/posts/{social_id}/comments` com JSON `{account_id, text}`. Devolve `{object:'CommentSent', comment_id}`.

## Regras

- **Passo:** `{kind:'comment', delayDays, guidance?}`.
  - `guidance` (até 300 caracteres) é a orientação opcional para a IA, por exemplo "tom curioso, sem vender".
  - O passo de mensagem continua `{delayDays, body}` (o `kind` é opcional e vale `message`).
- **Ativação:** uma cadência com passo de comentário só ativa com a capacidade `comment` habilitada, além do envio de mensagens que a cadência já exige.
- **Quando o passo vence:**
  - **Post:** o worker busca os posts da pessoa e escolhe o mais recente, próprio (sem repost), com texto, que aceita comentário e é dos últimos 30 dias. Sem post, o passo é pulado (motivo `no_post`) e a cadência segue.
  - **IA:**
    - a IA central (rota convencional HTTP da política da plataforma) recebe o texto do post, o nome, o cargo e a empresa, a orientação e o contexto da empresa;
    - devolve um comentário de 1 a 600 caracteres, sem link e sem pedido de reunião;
    - sem rota de IA, o passo fica retido e tenta de novo em 1 h;
    - uma resposta inválida da IA também retém o passo.
  - **Aprovação:** o comentário vira uma aprovação pendente e a pessoa fica "aguardando aprovação". A ação não conta no limite de mensagens. O espaçamento de 5 minutos por membro vale para a busca.
- **Aprovar:**
  - owner, admin ou operador aprova, com o texto possivelmente editado (até 1.250 caracteres, o limite do LinkedIn), mais `expectedRevision` e `requestId`;
  - antes de publicar, a capacidade `comment`, a conta pronta, a versão e o opt-out são conferidos de novo;
  - um envio incerto nunca é repetido;
  - o mesmo `requestId` devolve o mesmo resultado;
  - publicado, a cadência avança.
- **Rejeitar:** a aprovação fica rejeitada e a cadência avança, pulando o passo.
- **Vencimento e paradas:**
  - uma aprovação pendente vence em 7 dias, e a cadência avança;
  - se a pessoa responder, pedir opt-out ou a cadência parar, a aprovação pendente é cancelada.
- **Página `/linkedin/approvals`:**
  - abas Pendentes e Histórico (aprovadas, publicadas, rejeitadas, vencidas);
  - cada cartão mostra a pessoa, o trecho do post com o link, o comentário editável, "Aprovar e publicar" e "Rejeitar";
  - sem aprovações, continua o vazio da referência.
- **Custo:** a geração não consome créditos pré-pagos nesta entrega. O uso do provedor (tokens) fica registrado na aprovação. A cobrança continua decisão do usuário.

## Arquivos

- `db/migrations/105-linkedin-approvals.sql`: tabela `linkedin_approval`; funções de criar, listar, aprovar (claim e finish), rejeitar e vencer; a varredura de paradas da cadência cancela as pendentes.
- `src/domain/linkedin-sequence.ts`: união dos passos e `commentSchema`.
- `src/domain/linkedin-approval.ts`: views e schemas de aprovar e rejeitar.
- `src/server/linkedin/approvals.ts`: listar, aprovar, rejeitar e o gerador de IA (injetável).
- `src/server/linkedin/sequences.ts`: ramo do passo de comentário no tick.
- Rotas: `src/app/api/linkedin/approvals/route.ts` e `approvals/[id]/[action]/route.ts`.
- UI `src/modules/settings/linkedin-sdr.tsx`: a página Aprovações e o tipo de passo no editor da cadência.
- Testes: `tests/07a3c-linkedin-approvals.test.ts` e `tests/integration/07a3c-linkedin-approvals.test.ts`.

## Testes (RED primeiro)

1. Ativar uma cadência com comentário sem a capacidade `comment` dá 409. Com a capacidade, ativa.
2. O passo vence: a IA simulada recebe o post mais recente e válido, e nasce uma aprovação pendente. Nada é publicado.
3. Sem post válido, o passo é pulado e a cadência segue para a mensagem seguinte.
4. Aprovar com texto editado publica exatamente esse texto, uma vez. O mesmo `requestId` não republica, e uma revisão antiga dá 409.
5. Opt-out entre a aprovação e a publicação: nada sai. Um timeout fica incerto e não é repetido.
6. Rejeitar avança sem publicar. A aprovação vence em 7 dias. Uma resposta da pessoa cancela a pendente.
7. Workspaces, papéis, HTTP (401, 422, `no-store`) e SQL (o app não executa as funções do worker).
