# 06G.1 — Plano anual e franquia mensal

Data: 04/11/2026. Estado: **concluído local/controlado, com o Stripe simulado**. Nenhuma cobrança real ou de teste foi feita no Stripe, e o anual ainda não foi homologado lá ([revisão](06g1-annual-review.md), [plano de execução](../superpowers/plans/2026-11-04-prometeus-cadence-06g1-annual-execution.md)).

## O que o cliente consegue fazer

- **Comparação de planos:** o seletor "Mensal / Anual -20%" mostra Essential a R$ 317,60/mês, cobrado R$ 3.811,20/ano, e Pro a R$ 717,60/mês, cobrado R$ 8.611,20/ano, como na referência (EV-003 a EV-005).
- **Revisão:** o checkout anual mostra o total do ano e avisa que a franquia renova a cada mês, sem acumular.
- **Meu plano:** o assinante vê "Plano Pro anual", o equivalente mensal, o total cobrado por ano e a renovação. O catálogo já abre no ciclo dele.
- **Trocas:**
  - **Upgrade:** Essential para Pro no mesmo ciclo, com cobrança proporcional depois de revisar.
  - **Downgrade:** Pro para Essential no mesmo ciclo, na renovação.
  - **Troca de ciclo:** mensal ↔ anual no mesmo plano, sempre na renovação e sem cobrança agora.
  - **Plano e ciclo juntos:** recusado; são dois passos.
- **Mudança agendada:** enquanto há mudança agendada ou renovação cancelada, os outros botões ficam travados, e o destino aparece como "Agendado".

## Regras executáveis

- **Preço:** só do catálogo do servidor; o cliente manda o SKU. Se o Stripe devolver valor ou intervalo fora do catálogo, nenhum direito é concedido.
- **Franquia:**
  - o pagamento anual concede só a janela mensal corrente, não 12;
  - cada janela conta a partir do início do período pago, com o dia ajustado ao tamanho do mês, e termina no máximo em `period_end`;
  - o saldo de uma janela não passa para a seguinte; pacotes comprados não expiram;
  - o enriquecimento segue o mês do calendário, e a virada também o abre.
- **Virada:**
  - `billing_roll_annual` roda a cada ciclo do worker, em lotes de 25, sem chamar o Stripe, e pula contas travadas;
  - uma reserva que chega antes do worker abre a janela sob a mesma trava, então o pacote pago não é gasto no intervalo;
  - assinatura com pagamento pendente, cancelada, com pagamento bloqueado ou fora do período pago não abre janela.
- **Reembolso ou disputa:** revoga todas as janelas daquele pagamento.
- **Uma operação por vez:** continua havendo só uma alteração de assinatura aberta, inclusive retomada e checkout aguardando pagamento.

## Validação executada

- **Unitários:** 3/3 novos (SKUs, `planFromPrice`, `planChange`).
- **Integração focada:** 7/7, com o Stripe simulado em memória. Cobrem:
  - concessão e virada, idempotência e fim do período;
  - preço divergente, reembolso e operador 403;
  - troca de ciclo aplicada na renovação, repetição do evento e fatura `subscription_update` sem agendamento;
  - segundo checkout recusado com 409;
  - upgrade somando a diferença na janela aberta;
  - pagamento atrasado, segundo ano e assinatura substituída;
  - dia 31 e 29/02 iguais ao domínio.
- **Suítes completas:**
  - 435/435 unitários e 632/634 de integração; build e tipos com exit 0;
  - as duas falhas são `07A.3b assisted` e `07A.3c approving`, que dependem do horário e já falhavam antes do 06G;
  - a correção está no commit `6c0c618`, na branch `claude/jovial-ardinghelli-03da7a`, ainda sem merge aqui.

## QA no navegador

Conta descartável `[RE] QA Plano Anual`, com conta anual marcada por fixture e sem `customer_id`, para o worker não chamar o Stripe.
- **Catálogo:** seletor e preços anuais ([captura](evidence/06g1-annual/catalog-annual.jpg)).
- **Revisão:** "Pro anual", R$ 8.611,20 e o texto da franquia. Não confirmei, porque seguiria para o Stripe ([captura](evidence/06g1-annual/review-pro-annual.jpg)).
- **Meu plano:** "Plano Pro anual", R$ 717,60/mês e cobrado R$ 8.611,20/ano ([captura](evidence/06g1-annual/my-plan-annual.jpg)).
- **Mudança agendada:** aviso na página, destino "Agendado" e demais botões travados.
- **375 px:** sem overflow ([captura](evidence/06g1-annual/catalog-375.jpg)).
- **Corrigido no QA:** o ícone do Pro aparecia como "?", porque a coroa não estava registrada.
- **Limpeza (L-047 removed):** resíduo 0.

**Não exercitado no navegador:** confirmar qualquer operação, a retomada e o histórico com o nome do SKU. Esses caminhos estão só na integração ou na leitura do código.

## Limites

- **Stripe real:** nenhuma chamada. Falta homologar em modo de teste o checkout anual, o upgrade proporcional e a troca de ciclo.
- **Fatura da troca de ciclo:** não foi confirmado se o Stripe marca essa renovação como `subscription_cycle` ou `subscription_update`. As duas são aceitas, e a segunda só com agendamento, valor cheio, uma linha e início igual ao do período. Um relógio de teste do Stripe confirmaria.
- **Mudança de ciclo no registro:** mensal → anual fica registrada como `downgrade`, porque usa o mesmo agendamento na renovação; o histórico mostra o nome do plano.
- **Runtime em execução:** roda o código antigo até ser reiniciado, e a virada só começa depois disso.
- **06G.2 e 06G.3:** capacidade adicional e cupom continuam não implementados, e os cards seguem "Em breve".
- **Sem paridade integral:** esta entrega não declara paridade.
- **Entrega:** sem push, merge ou deploy.
