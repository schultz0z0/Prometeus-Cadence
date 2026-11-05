# Revisão final — 06G.1

04/11/2026. A revisão foi feita por um subagente independente, somente leitura, sobre a mudança antes do commit. Encontrou um Critical, um High, quatro Medium e oito Low. As regressões marcadas abaixo falhavam antes da correção (migração 111a).

| Achado | Correção | Regressão |
|---|---|---|
| Critical 1: a migração 111 estreitou o índice e deixou de bloquear retomada e checkout aguardando pagamento | Predicado da 075 restaurado, com os SKUs anuais | Segundo checkout: 409 `BILLING_OPERATION_PENDING` (falhava) |
| High 2: a renovação com troca de ciclo pode vir como `subscription_update`, porque a âncora muda | Aceita só com agendamento para o mesmo SKU, valor cheio, uma linha e início igual ao do período; repetição reconhecida pelo pagamento já registrado | Renovação aplicada e repetição `done`; sem agendamento nada muda (falhava) |
| Medium 3: "Meu plano" mostrava R$ 397/mês para o anual | Equivalente mensal e "cobrado X/ano" | Conferido no navegador |
| Medium 4: pacote pago podia ser gasto com a janela nova ainda fechada | `billing_reserve` abre a janela sob a trava da conta | Pacote intacto, 10 unidades saem da franquia (falhava) |
| Medium 5: a virada não abria o enriquecimento na troca do mês do calendário | Devida também sem `calendar:AAAA-MM`; cada unidade é inserida por si | Coberto pela leitura do código |
| Medium 6: testes sem renovação real | Período, preço e fatura novos; upgrade, pagamento atrasado, segundo ano, substituição, pagamento pendente, operador e dia 31 | Testes novos |
| Low 7: virada sem tratamento e com 100 contas travadas numa transação | Erro registrado sem parar os webhooks; lote de 25 com `SKIP LOCKED` | Coberto pela leitura do código |
| Low 8: estado não relido sob a trava | A função única relê a conta sob `FOR UPDATE` | Coberto pela leitura do código |
| Low 9: retomada falava "mensalidade" no anual | Texto escolhido pelo ciclo | Coberto pela leitura do código |
| Low 10: ciclo fora da prova e da revisão | `fromInterval` na prova, revisão sobe com plano ou ciclo, e o worker confere o preço atual antes de agendar | Coberto pela leitura do código |
| Low 11: botões ativos com mudança agendada | Travados, com "Agendado" no destino | Conferido no navegador |
| Low 12: histórico mostrava o SKU cru | `skuTitle` no histórico e na revisão | Coberto pela leitura do código |
| Low 13: `LIKE` com `_` no id | `starts_with` | Substituição e reembolso |
| Low 14: substituição mantinha o agendamento antigo | Limpa `next_plan` e `change_schedule_id` | Substituição |

## Aceitos sem mudança

- **Low 12 (parte):** mensal → anual continua registrado como `downgrade`, porque usa o mesmo agendamento na renovação.
- **High 2 (parte):** o comportamento real do Stripe não foi confirmado. O limite está no [relatório](06g1-annual.md).
