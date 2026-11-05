# 06G.3 — Cupom

04/11/2026. Terceira parte do [06G](2026-10-27-prometeus-cadence-06g-commercial-catalog.md), depois do [06G.2](2026-11-04-prometeus-cadence-06g2-capacity-execution.md).

## Referência

EV-004 e EV-005 da reauditoria de 24/10: no painel "Pacotes Adicionais", o texto "Tem um cupom?", um campo e "Aplicado ao pacote que você contratar". A validação, as mensagens e os tipos de desconto da referência não foram observados, porque aplicar um cupom lá seria escrita.

## Decisões

- **Onde vale:** só em pacotes de créditos, a compra única que este projeto vende como pacote. Plano e adicional recorrente ficam de fora: um desconto neles mudaria a validação de cada fatura, e a referência só mostra o campo nesse painel.
- **Campanha:** `billing_coupon` guarda código, id do cupom no Stripe, validade e limite de usos. O operador cria o cupom no Stripe e registra com `scripts/billing-coupon.mjs`. Não há tela de administração.
- **Sem cupom cadastrado:** o campo existe, e qualquer código é recusado. Nenhum cupom real é criado nesta entrega.

## Regras

- **Preço:** o cliente manda o código, nunca o valor. O servidor lê o desconto no Stripe e mostra o valor final na revisão.
- **Validade:** campanha ativa, dentro da validade, com uso disponível, e um uso por workspace. O cupom no Stripe precisa estar válido, com percentual ou valor em BRL, e o total não pode ficar abaixo de R$ 0,50.
- **Mensagem única:** código desconhecido, vencido, esgotado ou já usado dão o mesmo "Cupom inválido, vencido ou já utilizado", para não revelar quais códigos existem. As tentativas passam pelo limite de requisições de cobrança.
- **Reserva:** a confirmação reserva o uso sob trava, então a revisão aberta não garante o cupom. Sessão expirada ou operação recusada libera o uso; pagamento concluído o consome, e reembolso não o devolve.
- **Pagamento:** a sessão paga precisa ter o valor cheio como subtotal e o valor revisado como total, com tolerância de 1 centavo pelo arredondamento do Stripe. Fora disso, nenhum crédito é concedido.
- **Créditos:** a quantidade do pacote não muda com o desconto.
- **Acesso:** as duas tabelas ficam fechadas para os papéis da aplicação; só funções do banco as tocam.

## Persistência (113)

`billing_coupon`, `billing_coupon_claim`, `billing_check_coupon`, `billing_claim_coupon`, `billing_prepare_operation`, `billing_update_operation`, `billing_apply_event`.

## Testes (RED primeiro)

- **Unitários:** normalização do código e cálculo do desconto.
- **Integração, com Stripe simulado:**
  - cupom válido: revisão, sessão com o desconto, créditos cheios e uso consumido;
  - valor adulterado recusado;
  - desconhecido, inativo, vencido, esgotado e repetido;
  - cupom inválido no Stripe, em outra moeda ou abaixo do mínimo;
  - plano e adicional com cupom recusados;
  - último uso disputado por dois workspaces;
  - sessão paga com valor divergente não concede;
  - sessão expirada e recusa do Stripe liberam o uso;
  - operador 403 e tabelas fechadas para a aplicação.
