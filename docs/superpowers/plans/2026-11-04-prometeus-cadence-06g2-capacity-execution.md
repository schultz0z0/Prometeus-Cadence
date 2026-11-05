# 06G.2 — Capacidade adicional

04/11/2026. Segunda parte do [06G](2026-10-27-prometeus-cadence-06g-commercial-catalog.md), depois do [06G.1](2026-11-04-prometeus-cadence-06g1-annual-execution.md).

## Referência

EV-004 e EV-005 da reauditoria de 24/10: "Contas de E-mail" R$ 19,00/mês, "Números de WhatsApp" R$ 49,00/mês e "Usuários Extras" R$ 59,00/mês, com seletor de 1 a 10 unidades e "Contratar". "Módulo LinkedIn" custa R$ 149,00/mês.

O catálogo da referência mostra o mesmo preço mensal com o seletor em Anual, e não foi observado como ela cobra isso de um assinante anual.

## Decisões

- **LinkedIn:** continua "Em breve". O módulo depende de Unipile e aceite jurídico, e o projeto não vende recurso não operacional.
- **Enriquecimento recorrente:** não entra. O consumo continua pré-pago, como decidido.
- **Assinante anual:** o Stripe não mistura intervalos numa assinatura sem migrar o modo de cobrança. O adicional anual custa 12 vezes o mensal, sem o desconto de 20%, e a revisão mostra o valor por ano. É uma decisão própria, a confirmar quando a referência puder ser observada.
- **Sem tabela nova:** a conta guarda `capacity_extra` e `capacity_scheduled` em JSON. O preço fica no domínio, porque o catálogo SQL só tem franquia de plano e pacote.
- **Domínio em `billing.ts`:** as regras ficam junto do catálogo, sem o arquivo `capacity-policy.ts` previsto no plano original.

## Regras

- **Itens:** a assinatura tem um item de plano e até um item por adicional, todos no mesmo intervalo. Valor, intervalo, quantidade ou item fora do catálogo são divergência e não concedem direito.
- **Limite efetivo:** plano mais adicionais, só com assinatura `active` dentro do período. Atraso, atenção e cancelamento bloqueiam novos recursos sem apagar nada. Cancelar zera os adicionais.
- **Aumento:**
  - revisão com a prorrata prevista pelo Stripe; o cliente manda o total desejado, nunca o preço;
  - `pending_if_incomplete` e `always_invoice`, e o direito só vale com a fatura aprovada paga;
  - quantidade aumentada no Stripe sem operação aprovada não concede nada até uma renovação paga pelo total certo.
- **Redução:**
  - recusada com recurso em uso acima do novo limite, e a tela orienta desconectar primeiro; nada é apagado;
  - no Stripe a quantidade muda sem prorrata, então a próxima fatura já sai menor;
  - o direito pago continua até a renovação, mas novos recursos respeitam a quantidade agendada;
  - com redução agendada não há outra troca daquele adicional até a renovação.
- **Renovação:** a fatura de ciclo precisa bater com plano mais adicionais, linha a linha.
- **Troca de plano ou ciclo:** o agendamento preserva os adicionais; numa troca de ciclo, eles passam para o preço do novo ciclo.
- **Reembolso ou disputa da fatura de adicional:** coloca a conta em atenção e retira a quantidade que aquela fatura somou, sem revogar a franquia do período.
- **Uma operação por vez:** `capacity` entra na mesma guarda de assinatura.

## Persistência (112)

`billing_account.capacity_extra` e `capacity_scheduled`, `billing_capacity_limit`, guardas de canal e assento, `billing_prepare_operation`, `billing_update_operation`, `billing_apply_event`, índice de operação e tipo `capacity`.

## Testes (RED primeiro)

- **Unitários:** ofertas, preço por item, parser de itens, regra de redução e título do SKU.
- **Integração, com Stripe simulado:**
  - aumento pago libera, sem pagamento não libera, repetição não duplica;
  - quantidade no Stripe sem aprovação não concede, e a renovação paga concede;
  - redução em uso recusada, redução agendada segura o limite e vale na renovação;
  - cancelamento e atraso;
  - agendamento de plano e de ciclo com adicionais; upgrade com adicional;
  - anual com o preço do ciclo;
  - operador 403, quantidade inválida 422, LinkedIn indisponível, segunda operação 409;
  - fatura anulada falha a operação, e reembolso não revoga a franquia.
