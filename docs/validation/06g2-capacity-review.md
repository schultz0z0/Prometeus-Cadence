# Revisão final — 06G.2

04/11/2026. A revisão foi feita por um subagente independente, somente leitura, sobre a mudança antes do commit. Não encontrou Critical nem caminho que libere adicional sem fatura paga. Encontrou dois High, três Medium e seis Low, além de lacunas de teste. As regressões marcadas abaixo falhavam antes da correção (migração 112c).

| Achado | Correção | Regressão |
|---|---|---|
| High H1: toda redução fazia os eventos seguintes falharem até a próxima fatura, porque a última fatura paga deixava de bater com os itens | Fatura já registrada que não bate mais é aceita como leitura: a conta sincroniza, sem conceder nada | `deliver` agora exige o evento `done` (falhava) |
| High H2: fatura de adicional ou de upgrade podia mover o período para além de uma renovação não processada | Revisão e worker recusam com período virado; a fatura de adicional não altera o período; só a fatura inteira do período transforma quantidade em direito | Período virado: 409 e operação falha; período intacto (falhava) |
| Medium M1: pagamento de adicional que perdia a corrida para a renovação deixava a operação aberta e bloqueava a conta | A leitura seguinte reconhece a fatura aprovada paga e conclui | Operação concluída (falhava) |
| Medium M2: redução só segurava o limite depois de chamar o Stripe | Reserva a quantidade agendada na preparação, sob a mesma trava das guardas, e libera se a operação falhar | Segura durante a chamada, libera na falha (falhava) |
| Low: quantidade alterada fora do fluxo era adotada numa primeira tentativa | Só relê a quantidade se o pedido ao Stripe consta no registro | Operação falha (falhava) |
| Low: nova prévia no worker repetia a chave e podia devolver a resposta antiga | Chave própria da operação, também no upgrade | Coberto pela leitura do código |
| Low: reembolso voltava à quantidade antiga mesmo depois de uma renovação | Retira só o que aquela fatura somou, uma vez, dentro do período | Reembolso |
| Low: tela mostrava um limite e a guarda aplicava outro durante a redução | A tela usa o mesmo limite da guarda | Redução |
| Low: renovação só conferia total e quantidade de linhas | Cada item precisa ter a sua linha, com preço e quantidade | Renovação com quantidade errada não concede (falhava) |
| Low: botões desabilitados sem explicação; texto diferente da referência | Motivo no card e texto de EV-004 | Conferido no navegador |
| Lacunas de teste | Upgrade pago com adicional, troca de ciclo aplicada, anual completo, e-mail e assentos nas guardas, recuperação de queda | Testes novos |

## Aceitos sem mudança

- **Medium M3:** cancelar e assinar de novo mantém os recursos já conectados acima do limite, porque as guardas só barram expansão e nada é apagado em silêncio. É o mesmo comportamento do downgrade de plano. Fica como limite no [relatório](06g2-capacity.md) e decisão de produto.
- **Upgrade (Low):** a mesma adoção de quantidade fora do fluxo existe no upgrade de plano. Lá a revisão já recusa preço fora do plano atual, e a janela é mínima.
- **Stripe real:** o revisor apontou, de memória, itens a confirmar no modo de teste, principalmente `pending_if_incomplete` ao criar um item novo. Estão no relatório.
