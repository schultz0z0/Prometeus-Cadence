# Revisão final — 08A.2

05/11/2026. A revisão foi feita por um subagente independente, somente leitura, sobre a mudança antes do commit. Encontrou um Critical, seis High, sete Medium e alguns Low. Na conclusão dela, **o auditor superestimava o aceite do jeito que estava escrito**, e isso foi corrigido antes de qualquer número ser reportado.

| Achado | Correção | Regressão |
|---|---|---|
| Critical C1: itens prometiam mais do que rodava, como "pacote, renovação e cancelamento" abrindo só uma revisão | Registro dividido: o item com `run` diz só o que rodou, e o resto virou item pendente ou bloqueado | Teste impede palavras como "renovação" e "MCP" em itens de `run` que não as executam |
| High H1: a asserção do 503 sempre passava, porque o anúncio de rota do Next tem `role=alert` | Confere o aviso real, e isso expôs um defeito de produto: **a mensagem de erro ficava atrás do diálogo** | Aviso em popover aberto, sobre o diálogo |
| High H2: a limpeza por padrão de e-mail podia apagar um workspace real e as contas de outra rodada | `qa-cleanup.mjs` remove só por id o que a rodada criou | Resíduo 0 por id |
| High H3: erros de página e de API não reprovavam | Cada jornada reprova em qualquer erro fora da lista declarada | `unexpected` no relatório |
| High H4: asserções falsas (`/Concluíd/` casava com um rótulo fixo, `.catch` em cliques, sombra estática contava como foco) | Asserções específicas; foco compara o estilo antes e depois; menu e notificações confirmam o fechamento | Jornadas |
| High H5: o registro poderia chegar a 100% sem comparação visual | Item próprio, pendente | Teste exige o item |
| High H6: o plano descrevia uma jornada de prospecção local que não existia | Item próprio, pendente | Teste exige o item |
| Medium M1: nada conferia se o texto grande tinha sido aplicado | Mede o `font-size`, e agora a 320 px, o pior caso | Teste do auditor |
| Medium M2: zoom e texto usavam só `ok`, ignorando destino e tema | Passam só se todas as rotas passarem nas regras do auditor | Teste do auditor |
| Medium M3: o hash cobria só `src`; relatório velho de jornada não era sinalizado | Hash inclui migrations e scripts de medição, calculado no início e conferido no fim | Testes |
| Medium M4: um único item de referência cobria vários estados | Um item por estado, citando o relatório certo | Registro |
| Medium M5: devolver o foco podia rolar a página | `preventScroll` | Leitura do código |
| Medium M6: resíduo contava só usuários | Limpa todas as tabelas de `auth` por usuário e por workspace | Resíduo por id |
| Medium M7: a jornada de pacote usava piloto, que pula os bloqueios de estado | Usa o teste de 7 dias real | Jornada |
| Low: módulo podia pular a prova por um `run` | Bloqueado | Teste |

## Aceitos sem mudança

- **Status digitados:** "assinatura: pagamento" e "pacote, renovação e cancelamento com efeito real" estão aprovados com base nos relatórios do 06A-H e do 06G. Foram feitos à mão, e o registro diz isso.
- **`zoom200`:** 960x428 equivale a 1920 a 200%, mas mede só o carregamento. Diálogos nessa altura não foram medidos.
- **Isolamento:** provado para leads; não para chaves de API e demais superfícies.
- **Hash:** não prova o que o servidor em execução serve. A medição usa o servidor de desenvolvimento, que recarrega o código, e os relatórios valem para ele.
- **Captura de falha:** poderia mostrar uma chave descartável. As capturas de falha não entram no commit.
