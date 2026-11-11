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

## Diferenças que ficam

- **Relatório de funil:** faltam os filtros por canal (chips) da referência. É uma funcionalidade e precisa de marco próprio, não de ajuste visual.
- **Relatórios:** a ilustração do estado vazio é menor que a da referência. Diferença menor.

## Limites

As capturas cobrem só a primeira tela (855 px), enquanto as da referência são da página inteira. Celular (390 px) não foi revisado nesta rodada. Os estados com dados reais não foram comparados.
