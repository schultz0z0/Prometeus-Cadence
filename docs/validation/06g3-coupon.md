# 06G.3 — Cupom

Data: 04/11/2026. Estado: **concluído local/controlado, com o Stripe simulado**. Nenhum cupom real foi criado, e nada foi homologado no Stripe ([revisão](06g3-coupon-review.md), [plano de execução](../superpowers/plans/2026-11-04-prometeus-cadence-06g3-coupon-execution.md)).

Com o 06G.3, o 06G fecha no escopo local. Ainda falta homologar o 06G inteiro no Stripe de teste, e o módulo LinkedIn não é vendido.

## O que o cliente consegue fazer

- **Painel Pacotes Adicionais:** "Tem um cupom?", como na referência (EV-004). O código vale para o pacote de créditos comprado em seguida.
- **Revisão:** mostra "de R$ 97,00 por R$ 87,30", e os créditos do pacote não diminuem.
- **Código recusado:** sempre a mesma mensagem, "Cupom inválido, vencido ou já utilizado."

## O que o operador faz

Cria o cupom no Stripe e registra a campanha:

```bash
node scripts/billing-coupon.mjs BEM-VINDO id_do_cupom_no_stripe 2026-12-31 100
```

A data é o último dia válido, no horário do Brasil. `--update` altera uma campanha e `--inactive` a desativa. `--release CÓDIGO WORKSPACE` devolve um uso preso em operação incerta, depois de conferir no Stripe que não há sessão pagável. Não há tela de administração.

## Regras executáveis

- **Preço:** o cliente manda o código; o desconto vem do Stripe, e a revisão assinada amarra total, código e id.
- **Validade:** campanha ativa, no prazo, com uso disponível, e um uso por workspace. O cupom no Stripe precisa estar válido, com percentual ou valor em BRL, e o total não pode ficar abaixo de R$ 0,50.
- **Uso:**
  - reservado na confirmação, sob trava: abrir a revisão não garante nada, e o último uso vai para um workspace só;
  - consumido com o pagamento; reembolso não devolve;
  - devolvido com sessão expirada (1 h), pagamento caducado, recusa do Stripe ou cupom alterado depois da revisão;
  - mantido enquanto o resultado é desconhecido.
- **Pagamento:** a sessão paga precisa ter o valor cheio como subtotal e o revisado como total, com tolerância de 1 centavo. Fora disso, nenhum crédito. Desconto sem cupom aprovado também não concede.
- **Acesso:** proprietário ou administrador. As tabelas ficam fechadas para os papéis da aplicação.

## Validação executada

- **Unitários:** 2/2 novos (código e cálculo do desconto).
- **Integração focada:** 12/12, com o Stripe simulado em memória. Cobrem:
  - fluxo completo, adulteração e repetição;
  - cada motivo de recusa;
  - último uso disputado e concorrência no mesmo workspace;
  - valores divergentes e arredondamento;
  - expiração, caducidade, operação incerta, reembolso e cupom alterado;
  - operador 403, tabelas fechadas e script do operador.
- **Suítes completas:**
  - 440/440 unitários e 655/657 de integração; build e tipos com exit 0;
  - as duas falhas são `07A.3b assisted` e `07A.3c approving`, que dependem do horário e já falhavam antes do 06G; a correção está no commit `6c0c618`, na branch `claude/jovial-ardinghelli-03da7a`, ainda sem merge aqui;
  - a execução anterior teve mais duas falhas:
    - `customer creation retries...` veio do meu teste, que deixava uma operação `uncertain` no banco compartilhado; corrigido;
    - `email migration preserves...` caiu com "terminating connection due to administrator command" e não se repetiu, nem sozinha nem na execução completa seguinte. A causa não foi identificada.

## QA no navegador

Conta descartável `[RE] QA Cupom`, com teste de 7 dias marcado por fixture e nenhuma campanha cadastrada.
- **Campo e dica** no painel ([captura](evidence/06g3-coupon/coupon-refused.jpg)).
- **Código inexistente:** recusado com a mensagem única, sem abrir revisão. A rota respondeu 422 em 34 ms de aplicação, e esse caminho recusa antes de chamar o Stripe.
- **375 px:** sem overflow ([captura](evidence/06g3-coupon/coupon-375.jpg)).
- **Limpeza (L-049 removed):** resíduo 0, nenhuma campanha ou uso restante.

**Não exercitado no navegador:** cupom válido e revisão com desconto, porque leriam o Stripe; o campo travado e a limpeza depois da compra. Esses caminhos estão só na integração ou na leitura do código.

## Limites

- **Stripe real:** nada homologado. A confirmar em modo de teste:
  - `discounts` com `price_data` em `mode=payment` e o formato real da sessão;
  - o arredondamento do percentual;
  - cupom com `applies_to`, `redeem_by` ou `max_redemptions`; evite usá-los até conferir;
  - o estado do pagamento de um boleto vencido.
- **Escopo:** não vale para plano nem para adicional recorrente.
- **Abuso:** novos workspaces em teste podem repetir um cupom. O limite real é `max_uses`.
- **Runtime em execução:** roda o código antigo até ser reiniciado.
- **Sem paridade integral:** esta entrega não declara paridade.
- **Entrega:** sem push, merge ou deploy.

## Atualização de 05/11

A parte de Stripe dos limites acima foi homologada em modo de teste, e dois defeitos foram corrigidos. Veja o [relatório da homologação](06g-stripe-homologation.md).
