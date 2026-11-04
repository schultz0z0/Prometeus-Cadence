# Revisão final — 07B.1

04/11/2026. A revisão foi feita por um subagente independente, somente leitura, sobre a mudança antes do commit. Não encontrou Critical. Encontrou dois High, oito Medium e oito Low, todos corrigidos na 108a, no serviço ou na UI. As regressões de H2, M1, M3, M4, M5, L3, L4 e L8 falhavam antes da correção; os achados de UI foram conferidos no navegador.

| Achado | Correção | Regressão |
|---|---|---|
| High H1: salvar um agente novo remontava o editor com os padrões, e o próximo salvamento apagava o rascunho | O agente salvo entra na tela antes da troca, e o editor recebe o rascunho devolvido | No QA, os campos ficaram depois de salvar |
| High H2: o mesmo `requestId` depois de uma edição devolvia a ativação antiga sem ativar a nova revisão | A idempotência exige a mesma revisão ativa, e cada revisão gera um `requestId` novo | Mesmo id depois da edição ativa a revisão nova |
| Medium M1: salvar, conhecimento e simulação funcionavam sem Pro (simulação com a IA central) | Gate do Pro nas funções de escrita e de simulação | Sem Pro: 409 `SDR_PLAN` |
| Medium M2 e Low L6: limites contados sem trava (simulações, agentes, conhecimento) | Trava por workspace nas funções | Coberto pela leitura do código |
| Medium M3: `sdr_activate` aceitava configuração e canais do chamador | Snapshot do rascunho guardado; política dura reconferida no banco (`SDR_POLICY`) | Chamada direta com `bounded-auto` é recusada |
| Medium M4: o conhecimento podia mudar depois da revisão ou da ativação | A revisão inclui a revisão de cada item, o snapshot guarda id e revisão, e o worker exige os mesmos | Item editado e reaprovado tira o agente de serviço |
| Medium M5: a invalidação por contexto nunca disparava (versões só são acrescentadas) | O agente só atende com a versão aprovada mais recente | Aprovar um contexto novo pede nova revisão |
| Medium M6: o gate apresentava o SDR como recurso de um plano à venda | "Previsto para o plano Pro · em preparação"; sem a franquia de 300 conversas | Conferido no navegador |
| Medium M7: duas ativações concorrentes no mesmo canal davam 503 | Trava nas conexões e conflito de chave virando `SDR_CHANNEL_TAKEN` | Coberto pela leitura do código |
| Medium M8: o editor ficava "alterado" depois de salvar | Comparação canônica com chaves ordenadas | No QA, a revisão abriu logo depois de salvar |
| Low L1: canal ou item arquivado ficava preso no rascunho | Aparecem como "removido" ou "arquivado" para desmarcar | Coberto pela leitura do código |
| Low L2: mudanças em canais não escolhidos invalidavam a revisão | A prova inclui só os canais escolhidos | Coberto pela leitura do código |
| Low L3: `sdr_pro(workspace)` revelava o plano de outro workspace | Revogado do app; o app usa `sdr_entitled()` | Chamada direta: permissão negada |
| Low L4: sem Pro, o dono não conseguia pausar um agente | Os agentes continuam listados, com aviso, e a pausa funciona | Pausa depois do Pro vencido |
| Low L5: saída longa da IA era rejeitada e a simulação contava | A saída é cortada, não rejeitada | Coberto pela leitura do código |
| Low L7: o texto da pausa sugeria que o agente atendia | "Deixa de estar ativo nos canais dele" | Conferido no navegador |
| Low L8: operator editava ou arquivava conhecimento aprovado | Só proprietário ou administrador | Operator: 403 |
