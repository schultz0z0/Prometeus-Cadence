# Revisão final — 07A.3c

04/11/2026. A revisão foi feita por um subagente independente, somente leitura e em contexto novo, sobre o commit c143975. Encontrou dois High, um Medium e dois Low, todos corrigidos RED→GREEN na migração 105a. Antes da correção falhavam 3 testes de integração e 1 unitário.

Itens confirmados pela revisão:
- **Publicação:**
  - só o papel do app publica, depois da aprovação de owner, admin ou operador;
  - o worker só lê posts e cria a aprovação;
  - as funções internas não são públicas.
- **Sem repetição:** `requestId` idempotente; incerto (sem status ou 5xx) nunca repetido; publicação presa vira incerta; o fechamento exige o mesmo pedido e o mesmo usuário; versão divergente desfaz a reserva.
- **Cadência:** a cadência avança uma só vez e nunca avança uma cadência parada; rejeitar e vencer avançam.
- **Limites:** o passo de comentário não fica contando no limite diário e libera o espaçamento.
- **Permissões:** o app não lê o id do post, o id do comentário, o pedido, quem decidiu nem o provedor.
- **IA:** a saída é validada (tamanho, sem link); a publicação depende de uma pessoa.
- **UI:** estados de carregamento, erro e vazio, e confirmação antes de publicar.

| Achado | Correção | Regressão |
|---|---|---|
| High: a IA real nunca gerava o comentário (o executor só aceita orçamento de saída 4096 ou 8192), e o passo ficava retido para sempre | O pedido usa 4096; os 600 caracteres ficam no schema. O gerador foi para `comment-ai.ts` | Teste unitário com o executor convencional real e um fetcher simulado |
| High: aprovar publicava para quem respondeu, para uma cadência arquivada ou uma campanha parada, e uma aprovação vencida, fora do horário em que a varredura roda | O claim confere a cadência da pessoa (aguardando no mesmo passo, cadência e campanha ativas), a resposta e o vencimento. A lista de pendentes esconde as vencidas | Vencida, respondida e arquivada dão 409 e nada é publicado |
| Medium: uma resposta manual pulava o comentário pendente, que continuava aprovável | A resposta só conclui rascunhos de mensagem; o comentário pendente continua em Aprovações | Resposta com comentário pendente: a cadência continua aguardando no mesmo passo |
| Low: IA sem rota ou com saída inválida era tentada de hora em hora, sem limite | Na terceira falha o passo é pulado | Três falhas: o passo seguinte entra e a IA não é chamada de novo |
| Low: depois da recusa do LinkedIn o cartão seguia acionável | Erro de aprovar ou rejeitar recarrega a lista | Coberto pela leitura do código |

## Menores aceitos

1. **Prompt sem o contexto da empresa:** o comentário usa o post, a pessoa e a orientação.
2. **Ordem dos pendentes:** do mais antigo para o mais novo, sem filtro por campanha.
