# 07A.3a — Pessoas, pipeline e conversas no LinkedIn

Data: 03/11/2026. Estado: concluído local/controlado, com a Unipile simulada nos testes ([revisão](07a3a-linkedin-conversations-review.md), [plano de execução](../superpowers/plans/2026-11-03-prometeus-cadence-07a3a-linkedin-execution.md)).

O 07A.3 foi dividido como o 07C.2:
- **07A.3a (este):** pessoas, pipeline, conversas sincronizadas e resposta revisada.
- **07A.3b:** cadência pós-aceite e templates LinkedIn. Os passos LinkedIn da régua hoje só existem no rascunho.
- **07A.3c:** aprovações de comentários, que dependem de um passo de comentário com IA.

Nenhuma mensagem real saiu, e nenhuma chamada foi feita à Unipile ou ao LinkedIn.

## O que o cliente consegue fazer

- **`/linkedin/people`:** lista as pessoas das campanhas com etapa, campanha, empresa e última atividade real (convite, aceite, resposta ou mensagem).
  - Há busca por nome ou empresa e filtro por etapa.
  - "Conversa" abre o histórico.
  - "Não contatar mais", com confirmação, vale para todas as campanhas daquela pessoa.
  - Sem ninguém, continua o vazio da referência.
- **Conversa:**
  - mensagens em ordem, com as enviadas à direita;
  - para responder, "Revisar resposta" mostra o texto que vai sair, e "Enviar agora" precisa acontecer em até um minuto;
  - para mudar o texto, volta e revisa de novo;
  - quem pediu opt-out não recebe nada.
- **`/linkedin/pipeline`:** as cinco colunas da referência: Na fila, Aquecida, Convidada, Aceitou e Respondeu.
  - "Aquecida" fica vazia, com o motivo.
  - "Marcar como respondeu" vale para quem respondeu fora do LinkedIn. "Voltar para Aceitou" só aparece numa marca manual, nunca numa resposta real.
- **Aprovações, Cadências e Templates do LinkedIn:** continuam com o vazio e o aviso de indisponível (07A.3c e 07A.3b).

## Regras executáveis

- **Sincronização:**
  - o worker lê as mensagens novas da conta a cada 15 min, três páginas de 100 por rodada;
  - o cursor de página fica guardado entre as rodadas, e o "depois de" só avança quando a lista termina, com 1 h de folga;
  - só ficam conversas com pessoas das campanhas desta conta;
  - um chat desconhecido é resolvido uma vez e religado se a pessoa entrar numa campanha depois;
  - a deduplicação é pelo id da Unipile.
- **Respondeu:** uma mensagem recebida a partir do convite marca a pessoa como "respondeu", o que deve parar a cadência do 07A.3b.
- **Resposta:**
  - a revisão emite um token de 60 s, preso ao usuário, à conversa e ao texto;
  - a confirmação confere de novo a trava (envio de mensagens), a chave da plataforma, a conta pronta, a versão e o opt-out (com a linha da pessoa travada);
  - o mesmo `requestId` nunca envia duas vezes, e um envio incerto não é repetido;
  - a mensagem enviada entra com o mesmo id que a sincronização vê;
  - sem a chave da Unipile, nada é reservado nem marcado como incerto (vale também para os convites do 07A.2).
- **Pipeline:** o movimento manual só existe entre Aceitou e Respondeu, com revisão e `requestId`. Um convite ou um aceite nunca é inventado, e uma resposta real nunca é escondida.
- **Opt-out:**
  - vale para todas as linhas de campanha da pessoa no workspace;
  - tira da fila;
  - interrompe um convite em andamento (a pessoa fica "pulada");
  - bloqueia respostas.

## Diferenças em relação ao plano de tarefas

- **Divisão:** o pacote foi dividido em 07A.3a, 07A.3b e 07A.3c.
- **Migração:** 103 em vez de 099.
- **Opt-out:** fica na pessoa do LinkedIn, porque a supressão existente é por identidade de telefone ou e-mail.
- **Enriquecimento:** o do 06B.4 não foi ligado. O e-mail e o telefone do aceite já vêm do 07A.2.

## Validação executada

- **Unitários:** 3/3 no arquivo do pacote: colunas e etapas, movimento manual e entrada da resposta.
- **Integração focada:** 9/9, e 10/10 do 07A.2 de novo com os helpers compartilhados.
  - **Sincronização:** só a conversa da pessoa da campanha é guardada, sem duplicata; a pessoa passa a "Respondeu"; outro workspace recebe 404 e lista vazia.
  - **Resposta:**
    - texto alterado e token vencido dão 409;
    - o mesmo pedido não reenvia, e um token já usado dá 409;
    - a resposta enviada não duplica na sincronização.
  - **Bloqueios entre a revisão e a confirmação:** opt-out, trava sem envio de mensagens e conta revogada mandam 0 mensagens; o envio incerto não é reenviado.
  - **Pipeline:** revisão antiga dá 409, quem não aceitou dá 409, outro workspace recebe 404, e o mesmo pedido devolve o mesmo resultado.
  - **HTTP e SQL:** 401, `no-store`, nenhum id do LinkedIn na resposta, 404 em ação desconhecida, 422 em corpo vazio; o papel do app recebe 42501 no token, nas funções do worker e no id do chat.
  - **Sem a chave da Unipile:** a resposta dá 503 e fica "revisada"; o convite volta para a fila, sem ficar incerto.
  - **Achados da revisão:**
    - 350 mensagens guardadas em duas rodadas;
    - chat religado quando a pessoa entra numa campanha;
    - mensagem anterior ao convite não conta como resposta;
    - a resposta enviada é guardada uma vez;
    - opt-out com convite em andamento não envia.
- **Suítes completas:** 567/567 de integração e 408/408 unitários. Build e tipos com exit 0, e `git diff --check` limpo.
  - Na suíte completa, o teste das 350 mensagens falhava só por isolamento: as contas de outras suítes na mesma base ocupavam a rodada, que atende 20 contas.
  - O helper do teste passou a estacionar as contas de outros workspaces.

## QA no navegador

Conta descartável `[RE] QA LinkedIn Conversas`. A habilitação (leitura e envio assistido de mensagens), a conta pronta, a campanha ativa, quatro pessoas em etapas diferentes e uma conversa foram fixtures locais. Sem chave da Unipile, nenhuma chamada saiu.
- **Pessoas:** etapas certas, "Conversa" só para quem tem conversa, e a última atividade vem do fato real (corrigido no QA).
- **Conversa:** mensagens em ordem ([captura](evidence/07a3-linkedin-conversations/local-linkedin-conversation.jpg)). "Revisar resposta" mostra "A conexão com o LinkedIn ainda não está configurada neste ambiente." e mantém o texto ([captura](evidence/07a3-linkedin-conversations/local-linkedin-reply-not-configured.jpg)).
- **Tela de revisão:** com o texto e o envio em até 1 minuto, ela depende da chave real e não foi exibida. Está coberta pela integração.
- **"Não contatar mais":** pede confirmação, e a marca aparece. O texto do modal foi corrigido no QA.
- **Pipeline:** as cinco colunas ([captura](evidence/07a3-linkedin-conversations/local-linkedin-pipeline.jpg)). "Marcar como respondeu" move a pessoa, e "Voltar para Aceitou" só aparece na marca manual (acrescentado no QA).
- **375 px:** sem overflow horizontal em Pessoas e Pipeline; o pipeline rola por dentro.
- **Limpeza (L-039 removed):** resíduo 0, e as tabelas LinkedIn ficaram com 0 linhas.

## Limites

- **Contrato real da Unipile:** os campos de mensagens (`id`, `chat_id`, `is_sender`, `timestamp`, paginação) e do envio (`message_id`) vêm da documentação pública (SRC-014 e SRC-015) e precisam ser confirmados com a conta de teste.
- **Retenção:** o expurgo de texto de mensagens ainda não cobre as mensagens do LinkedIn.
- **Referência:** mostra Pessoas, Pipeline e Aprovações só vazios. A lista, a conversa e as colunas com pessoas seguem o padrão visual existente e ficam classificadas como não observadas.
- **Sem paridade completa:** cadência pós-aceite, templates e aprovações continuam pendentes (07A.3b e 07A.3c). Esta entrega não declara paridade.
- **Entrega:** sem push, merge ou deploy.
