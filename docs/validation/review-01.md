# Revisão final do marco 01

Revisor independente: contexto novo, somente leitura, commit `877488943829d7df1d19419cf07d0c5542baa01b`. A execução foi interrompida uma vez pelo limite da conta e retomada pelo mesmo revisor, que concluiu seu parecer. Não houve segundo revisor nem repetição da revisão depois das correções.

Parecer inicial: nenhum crítico, cinco importantes e um menor; pronto com correções. O revisor reexecutou os 24 testes então existentes. Os problemas estavam nos consumidores e não eram cobertos pela suíte inicial.

## Correções verificadas em uma passagem

| Achado | Correção | Evidência |
|---|---|---|
| Campo “Público” alterava nome, mantendo filtros antigos | Nome identificado explicitamente; termos e região editáveis na confirmação | Navegador persistiu “Escolas privadas” / “Recife, PE”, independentemente do nome; teste de persistência dos filtros revisados |
| Canal e-mail era descartado | Canal persistido nos filtros, módulos de extração derivados, atalho e wizard de cadência preservam a escolha | Teste inicialmente falhou por canal ausente; navegador confirmou `channel=email`, “Extrair e-mails”, limite 35 e E-mail selecionado no wizard seguinte |
| Subir/descer perdia texto em edição | Movimentação aplica o objeto editado e mantém imutabilidade da sequência anterior | Função ausente observada RED; teste passou; navegador moveu a mensagem revisada para a primeira posição e salvou texto/assunto corretos |
| Assunto não participava dos avisos de variável ausente | Prévia unifica assunto e corpo no canvas, editor e templates | Teste RED→GREEN; navegador mostrou aviso para variável ausente apenas no assunto |
| Criação manual repetida duplicava entidades | Operação com IDs estáveis, confirmação única e retry após falha de storage | Função ausente observada RED; dois testes passaram; clique duplo no navegador criou somente uma lista e uma automação |
| Pipeline e editor discordavam sobre elegibilidade | Regra compartilhada considera lista e qualificações aceitas | Reclassificado como importante pelo efeito nas contagens; teste RED→GREEN; navegador mostrou 11 cards aguardando, igual aos 11 elegíveis do editor |

No mesmo contrato de prévia foi reproduzida a resolução indevida de `{{toString}}` / `{{constructor}}` por propriedades herdadas. O teste falhou mostrando funções nativas em vez dos tokens; a resolução passou a aceitar apenas propriedades próprias. O teste passou mantendo os tokens e os avisos.

Suíte após as correções: **31/31**, sem falhas. Typecheck passou. Build e smoke final estão registrados no relatório principal. Nenhum achado importante conhecido ficou sem correção. Nenhum menor foi adiado pelo revisor: o único menor foi reclassificado e corrigido.

## Decisões sobre itens que o revisor deixou fora do julgamento

1. Autenticação, organizações e servidor: permanecem no marco de identidade aprovado. Custo de adiar: aplicação ainda não pode atender clientes com isolamento real.
2. IA e provedores de busca/enriquecimento: permanecem nos marcos de integração. Custo: somente simulações locais identificadas neste marco.
3. Cobrança, cotas, scheduler, envio e respostas: permanecem nos marcos operacionais. Custo: nenhuma receita, busca agendada ou mensagem real funciona nesta entrega.
4. LinkedIn/SDR conectados: permanecem como requisitos/prévias até a integração aprovada. Custo: nenhuma operação desses canais nesta entrega.
5. Paridade pixel a pixel e auditoria ampla de acessibilidade/escuro: não são alegadas. A QA visual e os checks de foco cobrem somente o que o relatório principal registra. Custo: diferenças finas ou barreiras fora desse roteiro podem existir.
6. Abandonar formulário não confirmado: mantido como estado temporário, conforme a aprovação por etapas. Custo: é necessário preencher de novo após abandonar/recarregar antes de confirmar.

## Demais decisões de execução e seus custos

- Nova pasta/repositório: branch local no diretório indicado, sem worktree adicional; custo: isolamento por branch.
- Ledger manual no Windows em vez de helpers POSIX; custo: bookkeeping manual.
- Porta 3210 porque a 3000 estava ocupada; custo: URL local diferente.
- Testes compartilhados por contrato depois de RED, em vez de funções duplicadas por tela; custo: cobertura de domínio precisa ser complementada por observação dos consumidores.
- Capturas inline salvas sem edição após recusa do caminho direto pelo MCP; custo: serialização adicional.
- Repositório novo sem branch-base nem remoto: manter `feat/cadence-interface` local; custo: publicação/integração posterior exige definir destino. Nenhum merge ou push foi executado.

Não foi instalada ou criada ferramenta/skill/MCP. O REA e sua skill foram reaproveitados. A consulta ao acervo O Setup permanece não concluída por HTTP 401, conforme a investigação; isso não foi tratado como ausência de recursos.
