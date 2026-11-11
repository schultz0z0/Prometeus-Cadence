# Revisão visual por área — 11/11/2026

Comparação das 29 áreas, CadenceFlow (capturas de 25/10/2026) contra Prometeus (conta de teste nova, desktop 1920, recaptura em 11/11). Ferramenta: `tests/manual/visual-compare.mjs`; página de revisão em `output/visual-review/index.html`. A revisão foi feita pelo agente a pedido do operador; o aceite final continua com o operador.

## Corrigido nesta revisão

| Área | Diferença | Ajuste |
| --- | --- | --- |
| Mensagens › WhatsApp | Estado vazio colado no topo; a referência o centraliza na tela | Estado vazio centralizado na altura útil |
| Configurações › Contas de e-mail | Estado vazio solto; a referência o põe num cartão | Estado vazio dentro de um cartão |
| Nova automação | Botão "voltar" separado do título; a referência põe a seta ao lado do título | Seta inline antes de "Nova Automação" |

As três recapturas conferem com a referência.

## Aceitas (diferenças só de estado ou já decididas)

Dashboard, Contatos, Gerador, Qualificador, Enriquecedor, Importar leads, Cadências, Nova cadência, Pipeline, Automações, Execuções, Caixa de e-mail, Relatórios, Agente SDR, Primeiros passos, LinkedIn (visão geral e campanhas) e todas as páginas de Configurações.

- A referência tinha listas e leads; a conta de teste começa vazia. Por isso a diferença de conteúdo não é defeito.
- "Aprender" e "Ajuda desta tela" existem no CadenceFlow atual (conferido ao vivo em 07/11).
- O trial de 7 dias e o OpenWA são divergências escolhidas pelo operador.
- LinkedIn › campanhas foi capturado ainda carregando. O estado vazio existe e foi conferido à parte.
- Webhooks tem uma seção de API a mais. CRM e apps mostra o FunnelsFlow desconectado, que é o estado da conta.

## Segunda rodada (11/11/2026, à tarde)

| Área | Diferença | Ajuste |
| --- | --- | --- |
| Relatório de funil | Faltavam os filtros por canal (Todos, E-mail, WhatsApp) | Filtros implementados com dados reais: mensagens, respostas e opt-outs pelo canal registrado; inscrições pelo canal das etapas da cadência publicada; contatos pelo e-mail ou telefone publicado. O detalhe de cada indicador respeita o filtro. |
| Relatórios (estado vazio) | Ilustração menor e solta; título e botão maiores; ícones dos cartões sem o círculo (variável de cor inexistente) | Ilustração do gráfico emoldurado como na referência, tipografia e botão no tamanho da referência, círculo dos ícones corrigido, ícone da aba Visão geral |
| Funil no celular | O desenho do funil virava uma faixa fina | O funil ocupa a altura útil, como na referência |
| Webhooks e API, CRM e apps no celular | Botão e selo de estado espremiam o título e o texto | Em telas estreitas, a ação ou o selo desce para a linha de baixo |

As capturas passaram a ser de página inteira, como as da referência.

## Celular (390 px)

As 29 áreas foram comparadas lado a lado em página inteira. Fora os quatro ajustes acima, as diferenças são de estado: conta nova sem dados, trial de 7 dias, OpenWA. A aba de Configurações não mostra o rótulo de grupo "CONTA" da referência, uma diferença menor.

## Diferenças que ficam

- **Configurações no celular:** sem o rótulo de grupo "CONTA" na faixa de abas. Diferença menor.

## Limites

Os estados com dados reais não foram comparados com a referência.
