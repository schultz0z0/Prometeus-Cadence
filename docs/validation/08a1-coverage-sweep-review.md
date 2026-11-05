# Revisão final — 08A.1

05/11/2026. A revisão foi feita por um subagente independente, somente leitura, sobre a mudança antes do commit. O portão geral já era honesto, mas **a primeira varredura, com 402 de 402, estava inflada e foi descartada**. Encontrou três Critical, cinco High, oito Medium e um Low. As regressões marcadas abaixo falhavam antes da correção.

| Achado | Correção | Regressão |
|---|---|---|
| Critical C1: redirecionamento contava como aprovação; sessão perdida viraria um `/login` aprovado | Toda linha guarda o destino final, e o auditor exige o destino esperado; redirecionamento precisa ser declarado | Destino errado falha; linha sem destino fica pendente (falhava) |
| Critical C2: o tema escuro nunca foi ativado, porque o app usa `cadence-ui`, não a mídia do navegador | A varredura grava o tema do próprio app e confere `data-theme`; páginas sem menu são classificadas à parte | Linha clara no viewport escuro falha (falhava) |
| Critical C3: o registro tinha `/reports/crm` e `/reports/activity`, que não existem, e faltavam `/reports/negocios`, `/settings/apps/*` e `/linkedin/campaigns/new` | Registro gerado das listas reais; aba inventada agora dá 404 | Teste compara o registro com as listas do código (falhava) |
| High H1: página quebrada passava | Texto da tela de erro e erros de console reprovam | Coberto pela varredura final |
| High H2: tela presa em "carregando" e erro 4xx de API passavam | Espera limitada, tela ocupada reprova, 4xx reprova salvo o declarado | Coberto pela varredura final |
| High H3: só estados vazios | 30 contatos na conta, conta Pro em piloto para passar do bloqueio, e marcador esperado na tela. O que continua sem dados virou item pendente, não aprovação | Marcador em `/contacts` e `/leads/:id` |
| High H4: evidência sem procedência | Relatório guarda o hash do código, e resultado sobre código diferente não conta | Relatório antigo: 0 aprovados (falhava) |
| High H5: apagar um item do registro subia a nota | Lista obrigatória no teste; popups e papéis entraram no registro | Teste (falhava) |
| Medium M1: qualquer arquivo valia como evidência | Só relatórios em `docs/validation/` | `package.json` recusado (falhava) |
| Medium M2: overflow só pelo `scrollWidth` | Controle fora da tela sem rolagem também reprova | Coberto pela varredura final |
| Medium M3: nome acessível leniente | `aria-label` vazio, referência quebrada e `placeholder` não contam; mais papéis medidos | Coberto pela varredura final |
| Medium M4: teste criado por `UPDATE`, sem limpeza | Usa a função do app e limpa as contas ao fim, sempre | Resíduo 0 impresso |
| Medium M5 e M6: regra de CSS ampla demais | Removida; correção por tela, com a classe `wrap` que o projeto já tem | Varredura final em todos os viewports |
| Medium M7: integração só com `Principal` editado | Sessão real por HTTP: workspace trocado 409, membro removido negado, lead por id com controle positivo | Testes novos |
| Medium M8: isolamento sem controle positivo | Cada conta precisa ver o próprio lead por id, e o auditor lê o resultado | Isolamento incompleto vira exceção (falhava) |
| Low L1: `/0 contatos/` casava com "10 contatos" | Regex exata | Teste |

## Aceitos sem mudança

- **Status de módulo digitado (M1, parte):** cobrança está como aprovada, com base nos dois relatórios citados. Os campos de prova continuam digitados, e o registro diz isso.
- **Popups:** a varredura não abre nada, porque só navega. Ficam no 08A.2.
- **Comparação com a referência a 768 px:** não foi feita. As correções de quebra de linha foram medidas só por overflow.
- **`title` como nome acessível:** continua aceito, porque é válido na especificação.
