# Revisão final — 07A.3b

04/11/2026. A revisão foi feita por um subagente independente, somente leitura e em contexto novo, sobre o commit 34b1937 e a UI ainda não commitada. Encontrou um High e quatro menores, todos corrigidos RED→GREEN na migração 104a (commit 961222f). Antes da correção falhavam 4 testes de integração.

Itens confirmados pela revisão:
- **Modo:** só envia com o envio automático habilitado. O modo assistido só deixa rascunho, e sem modo a cadência nem ativa.
- **Limites:** 30 por dia por membro, com trava por membro e pela conta; 5 minutos de intervalo; janela de dias úteis das 9h às 18h.
- **Incerto:** timeout, 5xx, lease vencido e reserva repetida param a pessoa e nunca reenviam.
- **Fato faltando:** para antes de enviar.
- **Opt-out:** bloqueia todos os caminhos, inclusive a mensagem que começa o chat.
- **Banco:** RLS e funções presas ao workspace; as funções do worker são só do `cadence_worker`; o fechamento exige o lease.
- **Mensagem por pessoa:** token de 60 s, mesmo usuário e mesmo texto; `requestId` idempotente; só para quem aceitou, no mesmo workspace.

| Achado | Correção | Regressão |
|---|---|---|
| High: uma campanha cancelada (ou pausada) continuava enviando a cadência | A varredura encerra com `campaign_ended` quando a campanha termina ou é cancelada; a reserva e o reteste exigem a campanha ativa | Campanha pausada: nada sai; retomada: sai; cancelada: o passo 2 nunca sai |
| A marca manual "Respondeu" não parava a cadência | `stage_override='replied'` conta como resposta na entrada, na varredura, na reserva e no reteste | Marca manual depois do 1º passo: o 2º não sai, motivo `replied` |
| Um reteste falho deixava a pessoa vencida, e ela era reservada de novo a rodada inteira | O reteste recebe o horário e adia a pessoa 15 minutos | Versão de capacidade divergente: `next_at` adiado 15 min |
| Arquivar durante um envio apagava o lease, e a mensagem entregue não era registrada | O arquivamento deixa a pessoa em envio para o worker; a varredura para depois | Arquivar entre a reserva e o fechamento: a mensagem fica na conversa, o envio fica `sent` e o motivo é `archived` |
| "Revisar rascunho" aparecia para quem pediu opt-out | O botão e o aviso exigem que a pessoa não tenha pedido opt-out | Coberto pela leitura do código; o servidor já bloqueava o envio |

## Menores aceitos

1. **Rascunho após opt-out:** o texto guardado só é limpo pela próxima varredura do worker, dentro da janela; a tela já não oferece o envio.
2. **Ordem entre pessoas com o mesmo horário:** segue o id; não há prioridade por antiguidade além do horário.
