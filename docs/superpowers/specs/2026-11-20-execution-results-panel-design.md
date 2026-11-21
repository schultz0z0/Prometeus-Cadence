# Telas de execução para o usuário final — desenho

Aprovado pelo usuário em 20/11/2026 (direção A refinada, "mapa de pontos"; organização em etapas por tarefa). Modelo de referência: `.superpowers/brainstorm/1539-1795201989/content/painel-a-v3.html` (fora do git).

## Por quê
A página da execução (`/executions/[id]`, `src/modules/prospecting/job-progress.tsx`, `job-results.tsx`) foi feita para homologar: mostra cada módulo, fontes, links da Apify, "sugestão sem acurácia medida" e uma linha por chamada técnica. Com 125 leads ficou enorme; com 500 é inviável. Para aprovar, o usuário clica "Carregar mais" de 25 em 25 e aplica no máximo 100 por vez. O usuário final não entende esses registros: quer ver o processo de forma visual e agradável, ver o resultado e aprovar em lote.

## Objetivos
- Durante a execução: progresso visual e legível em segundos, sem registros técnicos.
- Ao terminar: o resultado em grupos, com aprovação em lote por grupo em um clique, para até 500 leads.
- Conferir antes de aprovar continua possível (lista enxuta, desmarcar exceções).
- Os registros técnicos continuam acessíveis para quem administra, fora do caminho do usuário.

## Escopo e etapas
Toda tarefa que abre a página de execução ganha uma tela pensada para o usuário final: uma **estrutura comum** (cabeçalho com frase de estado, mapa de pontos ao vivo com as etapas da tarefa, link "Detalhes técnicos") e um **painel de resultado próprio da tarefa** (um destaque principal com a ação de aprovar, linhas discretas para o resto, nas palavras da tarefa). Feito em etapas, cada uma homologada no app antes da próxima, com o modelo da tela mostrado ao usuário antes:
1. Estrutura comum + **Qualificação** (este documento detalha).
2. **Geração** (Google Maps, busca na web, CNPJ por CNAE/cidade): empresas novas na lista, já existentes, descartadas e o motivo.
3. **Enriquecimento de decisores**: decisores com contato (cobra crédito), sócios só do cadastro, empresas não encontradas; criar a lista de decisores.
4. **Investigação da empresa** e **Sócios e gestores**: dados e pessoas achados para a empresa; aplicar.
5. **Planejamento** (leitura do site no Contexto de IA, opções de cadência com IA): a proposta pronta para revisar.
Ficam técnicas: Prospecção completa (histórico) e teste de conexão da IA (administração).

## Fora do escopo
- Mudar como as tarefas rodam (módulos, provedores, cobrança, tempo).
- Editar campo a campo na tela nova (continua na ficha do lead).

## Anti-objetivos
- Aprovar algo que o usuário não viu resumido: o botão diz quantas empresas e o que entra (e-mails, CNPJs, resumos).
- Aplicar sobre um lead que mudou depois da execução: a proteção atual (`ENRICHMENT_SOURCE_CHANGED`/revisão do lead) continua.
- Mostrar código técnico, nome de provedor ou URL de API na tela do usuário.
- Visual "cara de IA": nada de fileira de cartões iguais, rótulos em caixa alta, gradientes decorativos.

## Abordagem escolhida
Reescrever a apresentação da página de execução de qualificação em cima dos dados que já existem (itens da execução, resultados por módulo, campos propostos, parecer), com:

1. **Cabeçalho**: nome da lista, frase de estado ("Qualificando 125 empresas" / "125 empresas analisadas em 3h14") e link discreto "Detalhes técnicos".
2. **Mapa de pontos** (o elemento marcante): uma grade de pontos, um por lead do lote (até 500; 25 por linha no desktop, menos no celular).
   - Em andamento: pontos concluídos com a cor do grupo, o lead atual em laranja pulsando (sem animação com "reduzir movimento"), os demais vazados. Acima: "107 de 125, faltam cerca de 25 minutos" e as etapas ("Sites lidos", "CNPJ conferido", "IA avaliando o perfil", "Resumos") com a atual em destaque. Legenda com contagens ao vivo. Frase: "Pode fechar esta tela. O resultado fica em Execuções."
   - Concluída: pontos agrupados por cor (aderentes, sem informação, fora do perfil) para mostrar a proporção.
3. **Bloco principal "N empresas prontas para abordar"** (aderentes): o que entra (contagem de e-mails, CNPJs, resumos) e o botão **"Aprovar as N"**, que aplica todos os aderentes marcados em um clique.
4. **"Conferir a lista antes"**: lista enxuta, uma linha por empresa (nome, selos do que foi achado, motivo curto), todas marcadas; desmarcar tira da aprovação. Paginação/rolagem virtual para 500.
5. **Linhas discretas para os outros grupos**:
   - "N sem informação suficiente": "Salvar os contatos" aplica só os dados de contato e cadastro achados (e-mail, telefone, site, CNPJ, razão social e dados empresariais), deixando a qualificação como está.
   - "N fora do perfil": "Ver por quê" abre o parecer; aprovar marca como não aderente.
6. **Detalhes técnicos**: a visão atual (módulos, fontes, uso registrado) vira uma página/aba secundária, visível para dono e administrador.

Alternativas descartadas: (B) lista com abas e barra fixa — bom para conferir, pior para entender o lote de relance; (C) colunas estilo quadro — colunas longas demais com 500 leads.

## Visual
- Dentro da identidade do app: Manrope no texto, Sora nos números/títulos, `--primary #ff6b00`, `--green #00a781`, `--red`, fundo `--background`, tema escuro com os tokens existentes.
- Um único destaque (bloco dos aderentes, borda verde à esquerda); o resto quieto (linhas com divisória).
- Texto do botão laranja escuro o bastante para contraste AA (o modelo usa texto quase preto sobre o laranja).
- Responsivo até 320 px, foco visível de teclado, pontos com `title`/rótulo acessível (nome da empresa e grupo).

## Decisões do builder (minhas)
- **Escopo da etapa 1**: a estrutura comum é construída já pensando nas outras tarefas (o mapa de pontos e as etapas recebem os grupos e rótulos da tarefa); só a Qualificação ganha o painel de resultado novo nesta etapa; as demais mantêm o painel atual até a sua etapa.
- **Conflito no lote** (decisão do usuário, 20/11/2026): "Aprovar as N" aplica as empresas válidas e, no fim, mostra quantas ficaram de fora e por quê, em palavras simples ("foi editada depois da análise", "mudou de lista"), com a lista delas. O servidor passa a devolver resultado por item, idempotente.
- **Grupos**: pelo resultado do módulo de aderência (`qualified` → prontas; `disqualified` → fora do perfil; demais → sem informação). Sem o módulo de aderência na execução: um grupo só, "Dados encontrados", com "Aprovar os N".
- **Aprovação em lote**: um clique aplica o grupo inteiro; o limite atual de 100 itens por aplicação deixa de ser visível ao usuário (o servidor aceita até 500 ou o cliente envia em partes, somando um resultado único).
- **"Salvar os contatos"**: usa o mecanismo atual de recusa por campo na aplicação, recusando `qualification`, `reason` e `summary`.
- **Motivo curto**: a avaliação de aderência passa a devolver também uma frase de até 60 caracteres; leads avaliados antes disso mostram o motivo vazio (não se corta o parecer longo).
- **Tempo restante**: média do tempo por lead já concluído × leads restantes; só aparece depois de 3 leads concluídos.
- **Etapa atual**: derivada do último passo registrado na execução, mapeada para as 4 etapas visíveis.
- **Atualização ao vivo**: o mesmo intervalo de atualização que a página já usa.
- **Origem dos grupos**: o valor final proposto (`proposed.qualification`, o que de fato será gravado), não o veredito bruto da IA: `qualified` → prontas; `disqualified` (inclui a regra "sem e-mail") → fora do perfil; demais → sem informação. Itens sem nenhuma alteração proposta não entram no N nem no botão; aparecem só como contagem "sem nada a aplicar". Itens não processados (execução parcial/cancelada) ficam como pontos vazados.
- **"Salvar os contatos"**: marca o item como aplicado (mecanismo atual); como esses leads não têm qualificação a aplicar, nada se perde.
- **Detalhes técnicos**: restrição só de interface (o link aparece para dono e administrador); a API continua como está; quem pode aplicar hoje continua aprovando em lote.
- **Outros estados**: parcial é tratada como concluída, com a frase "Parte das empresas não foi analisada" e os pontos vazados; cancelada mostra o que foi feito até a parada; "precisa de conferência" mostra uma frase simples no topo e, para dono e administrador, o botão de conferir no próprio caminho (o fluxo de operação não muda); esperas de capacidade e falta de empresas verificadas aparecem em texto simples, sem código.
- **Fidelidade**: a referência (CadenceFlow) não tem captura desta tela de resultado; o desenho é próprio do Prometeus e não conflita com a regra de fidelidade.

## Etapa 2 — Geração (aprovada em 20/11/2026)
Modelo aprovado: `.superpowers/brainstorm/1539-1795201989/content/geracao.html` (fora do git).
- Mesma estrutura comum (cabeçalho, mapa de pontos, etapas, "Detalhes técnicos").
- Pontos: uma empresa examinada por ponto — nova na lista (verde), já estava na base (cinza-azulado), descartada (vermelho); em andamento, vazados até o total pedido e o laranja pulsando na vez atual.
- Etapas por fonte: Google Maps e Apollo — "Buscando no <fonte>", "Conferindo repetidas", "Salvando na lista"; busca na web — "Buscando na web", "Conferindo os sites", "Salvando na lista"; base CNPJ — "Buscando na base CNPJ", "Confirmando no Google Maps", "Conferindo o site", "Salvando na lista".
- Concluída: as empresas já entraram sozinhas na lista, então não há aprovação. Destaque "N empresas novas na lista <lista>", "Ainda sem qualificação.", o que veio (telefones, sites, notas do Google, e-mails, CNPJs — só os que existirem) e o botão "Qualificar as N", que abre o Qualificador com a lista escolhida; links "Ver as empresas" (lista enxuta com selos e cidade) e "Abrir a lista". Linhas discretas "N já estavam na sua base" (+ "Ver quais") e "N descartadas" (+ "Ver motivos", motivos em português).
- Decisões do builder: o tempo restante usa empresas examinadas; os motivos de descarte passam para um arquivo comum com os textos atuais; uma falha da busca aparece como "A busca parou antes de terminar." com o link de detalhes técnicos para dono e administrador.
