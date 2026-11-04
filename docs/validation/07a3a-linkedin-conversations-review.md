# Revisão final — 07A.3a

03/11/2026. A revisão foi feita por um subagente independente, somente leitura e em contexto novo, sobre os commits c60978f, e95af1b e f58010f. Não encontrou nada Critical.

Itens confirmados pela revisão:
- **Envio só por ação humana revisada:** todo envio exige revisar e confirmar, pelo mesmo usuário, na mesma conversa, com o mesmo texto e dentro de 60 s, e só a partir do estado "revisada". Um `requestId` repetido devolve o estado gravado e nunca envia de novo. Nada é enviado por agendamento: o worker só lê.
- **Reteste na confirmação:** trava desligada, conta revogada ou não pronta, versão de capacidade diferente e opt-out são conferidos de novo. Qualquer um deles desfaz a reserva junto com a transação, e nada sai.
- **Sem reenvio:** um envio incerto nunca é repetido.
- **Pipeline:** só se move à mão quem já aceitou, e uma resposta real não pode ser escondida. Revisão antiga dá 409, outro workspace recebe 404, e o mesmo pedido devolve o mesmo resultado.
- **Banco:**
  - RLS forçada nas tabelas novas, só com leitura;
  - as permissões por coluna escondem os ids do LinkedIn, o token e o cursor;
  - as funções do worker pertencem só ao `cadence_worker`;
  - a sincronização é idempotente por `UNIQUE(thread, remote_id)` e pelo lease;
  - uma falha mantém o cursor;
  - conversa com estranhos não é guardada.

Os cinco Important e os menores baratos foram corrigidos numa passagem RED→GREEN, na migração 103a (commit 084f244). Antes da correção falhavam 3 testes de integração.

| Achado | Correção | Regressão |
|---|---|---|
| A resposta enviada voltava duplicada na sincronização. A lista real traz um `provider_id` (do LinkedIn) diferente do `message_id` que o envio devolve | A sincronização usa o id da Unipile, que é o mesmo do envio. O fake passou a trazer `provider_id` | Resposta, depois sincronização: uma única mensagem |
| Com mais de 300 mensagens novas, as mais antigas eram puladas e o "respondeu" se perdia | O cursor de página e a mensagem mais nova ficam guardados entre rodadas. O "depois de" só avança quando a lista do fornecedor termina | 350 mensagens: todas guardadas em duas rodadas, inclusive a resposta mais antiga |
| Um chat guardado "sem pessoa" nunca era religado quando a pessoa entrava numa campanha | A thread guarda o participante e é casada de novo enquanto não tiver pessoa | Chat de alguém fora de campanha: não é guardado. Depois que a pessoa entra e responde, a conversa é ligada e ela aparece como "Respondeu" |
| Opt-out com um convite em andamento: a pessoa voltava para a fila e era convidada depois | A reserva de convite ignora quem pediu opt-out. O reteste e o 429 levam essa pessoa para "pulada" | Opt-out entre a reserva e o envio: nada sai e a pessoa fica "pulada" |
| Uma mensagem anterior ao convite marcava "respondeu" | Só conta mensagem recebida a partir do convite | Mensagem antiga fica no histórico, e a pessoa segue em "Aceitou" |

Menores corrigidos:
- **Opt-out:** vale para todas as linhas de campanha da mesma pessoa no workspace, como o modal promete.
- **Confirmação:** trava a linha da pessoa (`FOR SHARE`), para que um opt-out simultâneo não deixe passar um envio.
- **Fechamento da resposta:** fica preso ao autor.
- **Conversa longa:** mostra as 500 mensagens mais recentes.

## Menores aceitos

1. **Chats desconhecidos:** cada um custa uma consulta, sem teto por rodada. Uma falha que não seja 404 refaz o lote na rodada seguinte.
2. **Ordem de travas:** `finish_linkedin_messages` trava conta e depois pessoa, e o 429 de convite trava pessoa e depois conta. Um impasse exigiria a mesma pessoa nos dois ao mesmo tempo.
3. **Pedido repetido em andamento:** aparece como "incerto". É inofensivo, porque a tela bloqueia o botão enquanto envia.
4. **Revisão sem contagem regressiva:** a tela diz "Envie em até um minuto", mas não mostra o tempo restante.
5. **Folga de 1 h:** a folga relê mensagens já vistas. Se uma paginação ficar aberta entre rodadas, a mensagem que chega nesse meio entra uma rodada depois (atraso de 15 min, sem perda). O teste de 350 mensagens comprova isso com uma rodada a mais.
6. **Testes que faltam:** token de outro usuário, operador comparado a quem só lê, e paginação real da Unipile (o fake usa deslocamento).
