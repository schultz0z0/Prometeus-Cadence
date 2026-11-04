# 07A.2 — Campanhas de convite, público e aceites no LinkedIn

Data: 03/11/2026. Estado: concluído local/controlado, com a Unipile simulada nos testes ([revisão](07a2-linkedin-campaigns-review.md), [plano de execução](../superpowers/plans/2026-11-03-prometeus-cadence-07a2-linkedin-execution.md)).

Nenhum convite real saiu, e nenhuma chamada foi feita à Unipile ou ao LinkedIn. A operação real depende de três coisas:
- o contrato e a chave da Unipile;
- uma conta LinkedIn de teste própria;
- o atestado da plataforma com busca, convite e aceite comprovados nessa conta.

## O que o cliente consegue fazer

- **`/linkedin/campaigns/new`:** é o editor da referência (EV-241), agora salvo no workspace. Todos os controles visíveis ficam no rascunho:
  - nome;
  - público por filtros, por link de busca ou por post;
  - descrição, cargos, localização, setor, palavra-chave e graus;
  - triagem de decisor e as duas provas;
  - nota (até 300 caracteres, com `{nome}`, `{empresa}`, `{cargo}`, `{setor}` e `{prova}`);
  - convites por dia (até 12) e expiração;
  - aquecimento, enriquecimento e lista de não aceites.
- **"Explorar público":**
  - faz uma busca real pela conta do cliente, sem custo e sem gravar nada;
  - mostra o total e uma amostra de até 10 perfis;
  - um filtro que não chega ao LinkedIn é recusado antes de qualquer chamada: termo inexistente ou só parecido, link que não é de busca de pessoas, post sem id.
- **"Revisar e ativar":**
  - salva o rascunho e abre a revisão;
  - a revisão separa o **público real** (da exploração) da **estimativa** (cenário ilustrativo) e lista os bloqueios;
  - só owner ou admin ativa; operador salva e revisa.
- **`/linkedin/campaigns`:** lista as campanhas com o estado e a contagem por etapa:
  - etapas: na fila, convidados, aceites, sem confirmação, expirados, pulados e recusados;
  - ações: pausar, retomar e cancelar (com confirmação);
  - "Editar rascunho" para quem ainda não foi ativada.
- **Painel:** o passo 3 "Ligar a campanha" vira um link quando a conta está pronta.

## Regras executáveis

- **Bloqueios da ativação:**
  - conta pronta na versão atual do atestado;
  - capacidades `audience`, `invite` e `acceptance`;
  - aquecimento e triagem de decisor desligados, porque ainda não têm executor.
- **Ativar:** congela a revisão, liga a conta e cria a lista de aceites (e a de não aceites, se pedida). Uma campanha ativada não muda mais.
- **Coleta:**
  - pelo worker, uma página por campanha a cada rodada, com teto de 500 pessoas;
  - entra só quem está nos graus escolhidos;
  - fica de fora: conexão de 1º grau, grau desconhecido, convite pendente, empresa;
  - pessoa já convidada pelo mesmo membro LinkedIn entra como "pulada".
- **Convites:**
  - teto de 12 por dia de Brasília por membro LinkedIn, somando campanhas, mais o limite diário de cada campanha;
  - 20 min entre convites, em dias úteis das 9h às 18h;
  - uma vez por pessoa por membro, para sempre;
  - a nota só usa dados do perfil, e um dado ausente pula a pessoa;
  - antes de cada envio o worker relê a trava, a campanha, a conta e a época, e desfaz a reserva se algo mudou (pausa, cancelamento, revogação, trava desligada).
- **Desfechos do envio:**
  - rede, tempo esgotado ou 5xx: "sem confirmação", nunca reenviado;
  - 429: devolve à fila e segura a conta até a manhã seguinte;
  - 422: recusado.
  - Uma queda deixando a pessoa em "enviando" vira "sem confirmação" depois de 5 min.
- **Aceite:**
  - as relações da conta são lidas no máximo a cada hora;
  - um aceite gera um lead na lista de aceites e um evento, uma única vez;
  - o enriquecimento guarda só o e-mail e o telefone expostos no perfil.
- **Expiração:**
  - o convite é retirado depois de N dias;
  - se o convite já não existir, o perfil é consultado e o 1º grau conta como aceite;
  - o não aceite vai para a lista de não aceites, se configurada, sem resposta.
- **Desconectar a conta:** encerra as campanhas dela. Reconectar o mesmo membro mantém o livro de convites.
- **Cobrança:** os leads de aceite e de não aceite não consomem crédito pré-pago (exceção restrita ao worker nas listas da campanha). A cobrança do LinkedIn por conta conectada é uma decisão pendente do usuário.

## Diferenças em relação ao plano de tarefas

- **Migração:** 102 em vez de 098.
- **Explorar:** é `POST action:'explore'` com o rascunho, porque permite explorar antes de salvar.
- **Revisão:** usa a própria revisão da campanha, sem token separado.
- **Fora deste pacote:** "Montar filtros com IA" e "trecho da IA" continuam indisponíveis, com aviso; aquecimento e triagem de decisor ficam bloqueados com motivo; não há limite de frequência ao explorar.

## Validação executada

- **Unitários:** 6/6 no arquivo do pacote.
  - elegibilidade;
  - esquema do rascunho (todos os controles, teto 12, tokens, graus);
  - nota sem fato inventado;
  - janela de Brasília;
  - bloqueios;
  - links e graus.
- **Integração focada:** 10/10 (e 11/11 do 07A.1 de novo).
  - **Rascunho:** fica igual ao salvo; revisão antiga dá 409; teto acima de 12 dá 422; outro workspace recebe 404; salvar não chama nada.
  - **Explorar:**
    - cargos, IDs de localização e setor, palavra-chave e graus chegam à busca;
    - termo inexistente ou só parecido e link de empresas dão 422, sem nenhuma chamada;
    - link de busca e post funcionam;
    - sem a capacidade `audience`, dá 409.
  - **Ativação:** os bloqueios vêm primeiro; revisão antiga dá 409; operador dá 403; as listas são criadas; uma campanha ativada fica congelada.
  - **Duas campanhas na mesma conta:**
    - 12 no dia somando as duas;
    - nada no sábado;
    - nunca a mesma pessoa duas vezes;
    - 1º grau e convite pendente ficam de fora;
    - pessoa sem `{empresa}` é pulada;
    - no dia útil seguinte saem as 17 restantes, uma vez cada.
  - **Desfechos:** um envio sem confirmação não é reenviado; 429 segura a conta até a manhã seguinte; pausar depois da reserva não envia e devolve a pessoa à fila.
  - **Aceite:**
    - visto várias vezes, gera um lead e um evento;
    - o e-mail vem só do perfil, e quem não tem e-mail fica sem;
    - quem não aceitou expira, o convite é retirado e a pessoa vai para a lista de não aceites.
  - **Permissões:**
    - trava desligada e conta revogada impedem o envio;
    - HTTP: 401, 422, 404 em ação desconhecida e em outro workspace, `no-store`, nenhum id do fornecedor;
    - o papel do app recebe 42501 no livro de convites, nas funções do worker e no id externo.
  - **Achados da revisão:**
    - reconectar mantém o livro, e a campanha antiga fica concluída;
    - aceite fora das relações lidas vira aceite na expiração;
    - post respeita os graus;
    - "enviando" preso vira incerto.
- **Suítes completas:** 558/558 de integração e 405/405 unitários. Build e tipos com exit 0, e `git diff --check` limpo.
  - Na primeira rodada completa, um teste do Google Agenda (07C.2c, sem nenhuma alteração neste pacote) falhou porque dependia da hora de execução: a janela de "amanhã" cruzava o corte das 23:30.
  - O teste passou a usar o meio-dia de Brasília do dia seguinte e passa 8/8.

## QA no navegador

Conta descartável `[RE] QA LinkedIn Campanhas`, com a habilitação da plataforma (busca, convite e aceite) e a conta pronta como fixtures locais. Sem chave da Unipile, nenhuma chamada saiu.
- **Painel:** o passo 3 mostra "Montar e ativar uma campanha".
- **Editor:**
  - "Explorar público" mostra "A conexão com o LinkedIn ainda não está configurada neste ambiente." junto do botão, que é o lugar certo (corrigido no QA);
  - antes da correção, o erro caía na segunda coluna da grade;
  - a revisão mostra os dois bloqueios (aquecimento e triagem), o público real separado da estimativa e o aviso do teto;
  - com os dois desmarcados e a nota sugerida, a campanha foi ativada e apareceu como "Ativa".
- **Lista:**
  - pausar, retomar e cancelar (com o modal) funcionaram;
  - com pessoas de fixture, a contagem aparece como "Na fila 3, Convidados 2, Aceites 1, Sem confirmação 1, Pulados 1";
  - os rótulos foram corrigidos no QA para não errar o plural ([captura](evidence/07a2-linkedin-campaigns/local-linkedin-campaign-list.jpg)).
- **375 px:** sem overflow horizontal no editor nem na lista.
- **Capturas:** a captura de tela do painel falhou várias vezes (painel oculto). O editor e a revisão foram verificados pelo texto e pela estrutura da página; só a lista tem captura.
- **Limpeza (L-038 removed):** a conta, o workspace, as fixtures, a campanha, as pessoas e as listas foram removidos por ids exatos. Resíduo 0, e as tabelas LinkedIn ficaram com 0 linhas.

## Limites

- **Contrato real da Unipile:** os nomes de campo da busca clássica (`advanced_keywords.title`, `network_distance`, `industry`), das relações (`member_id`), da retirada (`invitation_id`) e do perfil (`contact_info`, `network_distance`) vêm da documentação pública (SRC-011 a SRC-013). Precisam ser confirmados com a conta de teste antes do atestado.
- **Referência:** a referência não mostra uma campanha ativa nem o resultado de "Explorar". Esses estados seguem o padrão visual existente e ficam classificados como não observados.
- **Sem garantia de paridade:** pessoas, pipeline, mensagens e aprovações ficam no 07A.3. Esta entrega não declara paridade.
- **Entrega:** sem push, merge ou deploy.
