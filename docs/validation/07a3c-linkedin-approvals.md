# 07A.3c — Aprovações de comentários no LinkedIn

Data: 04/11/2026. Estado: concluído local/controlado, com a Unipile e a IA simuladas nos testes ([revisão](07a3c-linkedin-approvals-review.md), [plano de execução](../superpowers/plans/2026-11-04-prometeus-cadence-07a3c-linkedin-execution.md)). Com esta parte, o 07A.3 está completo.

Nenhum comentário real foi publicado, e nenhuma chamada foi feita à Unipile, ao LinkedIn ou a um provedor de IA.

## O que o cliente consegue fazer

- **Editor da cadência:**
  - cada passo pode ser "Mensagem" ou "Comentar o post mais recente";
  - o passo de comentário tem uma orientação opcional para a IA (até 300 caracteres) e explica que o texto espera em Aprovações.
- **`/linkedin/approvals`:**
  - **Pendentes:** pessoa, cargo, empresa, campanha, data de vencimento, trecho do post com "Ver o post no LinkedIn" e o comentário da IA editável (até 1.250 caracteres), com "Voltar ao original";
  - "Aprovar e publicar" pede confirmação mostrando o texto final; "Rejeitar" pula o passo;
  - **Histórico:** publicado, sem confirmação, recusado pelo LinkedIn, rejeitado, vencido ou cancelado;
  - sem nada, continua o vazio da referência.

## Regras executáveis

- **Ativação:** uma cadência com passo de comentário só ativa com a capacidade `comment` habilitada.
- **Passo vencido:**
  - o worker busca os posts da pessoa e escolhe o mais recente que seja próprio, com texto, aberto a comentários e dos últimos 30 dias;
  - sem post, o passo é pulado;
  - com post, a IA central escreve o comentário (até 600 caracteres, sem link e sem pedido de reunião) e ele vira uma aprovação pendente;
  - se a IA falhar ou não houver rota, tenta de novo em 1 h e pula o passo na terceira falha (105a);
  - nada é publicado pelo worker, mesmo com o envio automático habilitado.
- **Aprovar:**
  - owner, admin ou operador aprova;
  - na hora, são conferidos de novo a capacidade, a conta pronta e a versão, o opt-out, a resposta da pessoa, o vencimento e se a cadência e a campanha continuam ativas (105a);
  - o mesmo `requestId` não publica duas vezes;
  - um envio sem confirmação fica "sem confirmação" e nunca é repetido; uma publicação presa há mais de 5 min também.
- **Encerramento:**
  - a aprovação pendente vence em 7 dias, e a cadência segue;
  - ela é cancelada quando a cadência da pessoa para;
  - uma resposta manual não pula um comentário que espera aprovação (105a).
- **Limites:** o passo de comentário não conta no limite de 30 mensagens por dia e respeita o espaçamento por membro.

## Diferenças em relação ao plano de tarefas

- **Onde fica o comentário:** a referência não mostra onde o passo de comentário é configurado. Ele foi posto na cadência pós-aceite do 07A.3b, como um tipo de passo.
- **Aquecimento:** visitar e curtir continua sem executor e bloqueado no editor da campanha; a coluna "Aquecida" segue vazia.
- **Contexto da empresa:** não entra no prompt nesta entrega. A IA recebe o post, a pessoa e a orientação.
- **Migrações:** 105 e 105a.

## Validação executada

- **Unitários:** 4/4 no arquivo do pacote, incluindo o pedido real ao executor de IA convencional com um fetcher simulado.
- **Integração focada:** 10/10, sendo 3 vindos dos achados da revisão, e 30/30 junto com 07A.3a e 07A.3b. Cobrem:
  - ativação sem e com a capacidade;
  - rascunho no post certo;
  - sem post;
  - aprovar com texto editado, uma única vez;
  - opt-out e incerto;
  - rejeitar, vencer e cancelar;
  - fronteiras de workspace, HTTP e SQL;
  - aprovação vencida ou de cadência parada;
  - resposta manual;
  - IA que falha.
- **Suítes completas:** 588/588 de integração e 416/416 unitários. Build e tipos com exit 0, e `git diff --check` limpo.

## QA no navegador

Conta descartável `[RE] QA Aprovacoes LinkedIn`. A habilitação (envio assistido e comentário), a conta pronta, a campanha e duas pessoas foram fixtures locais. As duas aprovações foram criadas chamando as funções reais do worker, com o post e o texto da IA como fixtures.
- **Vazio:** igual à referência ([captura](evidence/07a3c-linkedin-approvals/local-linkedin-approvals-empty.jpg)).
- **Editor:** o passo "Comentar o post mais recente" com a orientação ([captura](evidence/07a3c-linkedin-approvals/local-linkedin-cadence-comment-step.jpg)). A cadência foi salva e ativada.
- **Pendentes:** os dois cartões ([captura](evidence/07a3c-linkedin-approvals/local-linkedin-approvals-pending.jpg)).
  - Editar mostra "Você editou o texto da IA".
  - "Aprovar e publicar" abre a confirmação; sem a chave da Unipile, aparece "A conexão com o LinkedIn ainda não está configurada neste ambiente." e a aprovação continua pendente.
- **Rejeitar e Histórico:** "Rejeitar" leva o cartão ao Histórico ([captura](evidence/07a3c-linkedin-approvals/local-linkedin-approvals-history.jpg)), e a cadência da pessoa avança.
- **Corrigido no QA:** trocar de aba perdia o texto editado; as duas abas passaram a ficar montadas.
- **375 px:** sem overflow horizontal.
- **Limpeza (L-041 removed):** resíduo 0.

## Limites

- **Contrato real:** os campos de posts e de comentário vêm da documentação pública da Unipile (SRC-016) e precisam ser confirmados com a conta de teste.
- **IA real:** o pedido ao provedor foi validado só com resposta simulada.
- **Cobrança:** a geração não consome créditos; o uso fica registrado na aprovação.
- **Referência:** mostra Aprovações só vazia. A lista e os cartões seguem o padrão visual existente e ficam classificados como não observados.
- **Sem paridade completa:** esta entrega não declara paridade.
- **Entrega:** sem push, merge ou deploy.
