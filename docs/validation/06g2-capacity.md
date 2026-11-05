# 06G.2 — Capacidade adicional

Data: 04/11/2026. Estado: **concluído local/controlado, com o Stripe simulado**. Nenhuma cobrança foi feita, e os adicionais ainda não foram homologados no Stripe ([revisão](06g2-capacity-review.md), [plano de execução](../superpowers/plans/2026-11-04-prometeus-cadence-06g2-capacity-execution.md)).

## O que o cliente consegue fazer

- **Contratar:** "Contas de E-mail" R$ 19,00, "Números de WhatsApp" R$ 49,00 e "Usuários Extras" R$ 59,00 por mês, de 1 a 10 unidades por vez, até 50 no total, como na referência (EV-004).
- **Revisão:** mostra a cobrança proporcional prevista pelo Stripe e o valor por unidade a partir da renovação.
- **Reduzir:** de uma em uma. A capacidade paga continua até a renovação, e o card avisa a nova quantidade.
- **Limites na conta:** "Meu plano" soma plano e adicionais, e o banco aplica o mesmo limite ao conectar canais e convidar pessoas.
- **Sem assinatura ativa:** o card fica travado e diz o motivo.
- **Módulo LinkedIn e enriquecimento:** continuam "Em breve".

## Regras executáveis

- **Direito:** só com a fatura aprovada paga, ou com uma renovação paga pelo total certo, item a item. O retorno do pagamento não concede nada.
- **Quantidade alterada no Stripe sem operação aprovada:** não concede até uma renovação pagar por ela.
- **Limite:** plano mais adicionais, só com assinatura ativa no período. Atraso, atenção e cancelamento bloqueiam novos recursos sem apagar nada.
- **Redução:**
  - recusada se houver mais recursos em uso do que o novo limite, e a mensagem orienta desconectar;
  - segura o limite desde a preparação e libera se a operação falhar;
  - vale na renovação, e até lá não há outra troca daquele adicional.
- **Cancelamento:** zera os adicionais; os recursos conectados permanecem.
- **Troca de plano ou ciclo:** preserva os adicionais; na troca de ciclo eles passam para o preço do novo ciclo.
- **Período virado sem renovação processada:** recusa novas alterações até a conciliação.
- **Reembolso da fatura de adicional:** conta em atenção, quantidade retirada e franquia do período mantida.

## Decisão a confirmar

**Assinante anual:** o adicional custa 12 vezes o mensal, sem os 20% do plano, porque uma assinatura do Stripe tem um só intervalo. A referência mostra o mesmo preço mensal com o seletor em Anual, e não foi observado como ela cobra isso.

## Validação executada

- **Unitários:** 3/3 novos (ofertas, itens da assinatura e regra de redução).
- **Integração focada:** 11/11, com o Stripe simulado em memória, exigindo que cada evento seja processado até o fim. Cobrem:
  - pagamento, repetição e guardas de WhatsApp, e-mail e assentos;
  - quantidade sem aprovação e renovação com total ou linha errados;
  - redução em uso, agendada e falha;
  - cancelamento e atraso;
  - upgrade pago, troca de ciclo aplicada e anual completo;
  - período virado, corrida com a renovação e queda no meio da compra;
  - operador 403, validações, fatura anulada e reembolso.
- **Suítes completas:**
  - 438/438 unitários e 643/645 de integração; build e tipos com exit 0;
  - as duas falhas são `07A.3b assisted` e `07A.3c approving`, que dependem do horário e já falhavam antes do 06G;
  - a correção está no commit `6c0c618`, na branch `claude/jovial-ardinghelli-03da7a`, ainda sem merge aqui.

## QA no navegador

Conta descartável `[RE] QA Adicionais`, com assinatura marcada por fixture e sem `customer_id`, para o worker não chamar o Stripe.
- **Sem assinatura:** os três cards travados, com "Disponível com assinatura ativa."; LinkedIn "Em breve".
- **Com assinatura:** unidades contratadas, "Reduzir 1 unidade", e-mail 0/4 e WhatsApp 0/3 ([captura](evidence/06g2-capacity/capacity-cards.jpg)).
- **Redução agendada:** "Reduz para 1 na renovação", com os botões travados.
- **375 px:** sem overflow ([captura](evidence/06g2-capacity/capacity-375.jpg)).
- **Limpeza (L-048 removed):** resíduo 0.

**Incidente do QA:** tentei abrir a revisão com um stub local de `fetch`, mas o cliente não passa por ele. O clique em "Contratar" chegou ao servidor com a assinatura falsa, e a rota respondeu 503 ("Serviço indisponível"). Essa rota lê a assinatura no Stripe, então pode ter havido uma leitura no modo de teste com um id inexistente. Não houve escrita nem cobrança, e não repeti.

**Não exercitado no navegador:** o diálogo de revisão do adicional e confirmar uma operação. Esses caminhos estão só na integração.

## Limites

- **Stripe real:** nenhum fluxo homologado. A confirmar em modo de teste:
  - `pending_if_incomplete` ao criar um item novo;
  - remover item com `proration_behavior=none`;
  - fases com vários itens;
  - o motivo da fatura numa troca de ciclo;
  - a anulação da fatura de um pedido pendente.
- **Cancelar e assinar de novo:** os recursos conectados acima do limite permanecem, porque as guardas só barram expansão. O downgrade de plano faz o mesmo. É decisão de produto impor isso no envio.
- **Pagamento que perde a corrida para a renovação:** a operação conclui, mas o reembolso daquela fatura não aparece nos eventos seguintes da conta.
- **Depois de agendar uma redução:** não dá para desfazer antes da renovação.
- **Runtime em execução:** roda o código antigo até ser reiniciado.
- **06G.3:** cupom não implementado.
- **Sem paridade integral:** esta entrega não declara paridade.
- **Entrega:** sem push, merge ou deploy.
