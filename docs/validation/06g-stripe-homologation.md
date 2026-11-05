# 06G — Homologação no Stripe de teste

05/11/2026. Autorizada pelo usuário. **O 06G agora está homologado no modo de teste do Stripe, nos cenários abaixo.** Nada foi feito em modo live, e a assinatura original da Agência no sandbox não foi tocada.

A homologação achou dois defeitos que os testes simulados não podiam pegar, ambos corrigidos.

## Defeitos corrigidos

| Defeito | O que aconteceria | Correção | Regressão |
|---|---|---|---|
| Troca de ciclo sem cobrança | Mensal → anual trocava o preço na virada **sem emitir fatura** e esticava o período pago até um ano depois do início. O cliente ganharia 11 meses de graça. | A fase nova recomeça o ciclo (`billing_cycle_anchor=phase_start`), só quando o intervalo muda | Falhava na simulação e no Stripe; agora a virada cobra R$ 4.039,20 |
| Agendamento preso | Depois de aplicado, o agendamento ficava na assinatura durante toda a última fase. No anual, travaria upgrade, adicionais e downgrade por até um ano. | Ao processar a mudança, o app solta o agendamento, se for dele e já estiver na última fase | Falhava na simulação; no Stripe a assinatura fica sem agendamento e aceita nova alteração |

## O que foi confirmado no Stripe

| Cenário | Resultado real |
|---|---|
| Pacote com cupom de 10%, pago no Checkout hospedado | Subtotal R$ 97,00, total R$ 87,30, igual à revisão; 2.000 créditos cheios; uso consumido; repetição sem duplicar |
| Plano anual pago no Checkout hospedado | R$ 3.811,20, "R$ 317,60 / mês cobrado anualmente"; assinatura ativa, anual, com 5.000 de franquia e não 12 vezes isso |
| Adicional novo no anual | Prévia igual à fatura (R$ 588,00), motivo `subscription_update`, capacidade só depois de paga |
| Mais unidades do mesmo adicional | Prévia igual à fatura, com as linhas de crédito e débito da prorrata |
| Upgrade com adicional | Prévia igual à fatura; Pro aplicado, adicional preservado |
| Redução | Sem fatura própria, e os eventos seguintes são processados; capacidade paga até a renovação |
| Renovação anual real | `subscription_cycle`, R$ 9.199,20 (plano e um adicional, já com a redução aplicada); janela nova do ano |
| Reduzir a zero | Item removido com `proration_behavior=none` |
| Mensal → anual com adicional | `subscription_update`, R$ 4.039,20 na virada, adicional no preço anual |
| Anual → mensal com adicional | `subscription_update`, R$ 456,00 na virada, período de 30 dias |
| Cartão recusado no adicional | `pending_if_incomplete` aceito também ao criar item novo; fatura aberta, nenhuma capacidade |
| Pedido abandonado | Em 23 h o pedido pendente some e a fatura vira `void`; a operação falha, sem capacidade |
| Arredondamento do cupom | 33,5%, 12,5% e valor fixo: o total do Stripe foi igual ao da revisão nos três |
| Sessão de cupom expirada | Expirada de verdade pela API; o uso volta |
| Cupom apagado no Stripe | Recusa com a mensagem única |

Dados sem identificadores em [financial-proof.json](evidence/06g-stripe-homologation/financial-proof.json). Capturas: [cupom](evidence/06g-stripe-homologation/checkout-coupon.jpg) e [anual](evidence/06g-stripe-homologation/checkout-annual.jpg).

Isso também resolve a dúvida do 06G.1: a fatura de troca de ciclo vem como `subscription_update`, e o caminho aceito na revisão daquele pacote era necessário.

## Como foi feito

- **Roteiro:** [06g-stripe-homologation.test.ts](../../tests/integration/06g-stripe-homologation.test.ts), com chamadas reais e banco efêmero. Fica desligado sem `STRIPE_HOMOLOGATION=1`, então a suíte comum nunca toca no Stripe.
- **Renovações:** um Test Clock por cliente. O relógio do computador não muda.
- **Pagamentos no Checkout:** dois, no navegador, com o cartão de teste público.
- **Execução final:** 5/5 cenários depois das correções. Os dois pagamentos no Checkout rodaram antes da correção do agendamento, que não afeta esse caminho, e não foram repetidos.
- **Suítes completas:** 440/440 unitários e 655/657 de integração, com os 5 cenários reais pulados na suíte comum; build e tipos com exit 0. As duas falhas são `07A.3b assisted` e `07A.3c approving`, que dependem do horário; a correção está no commit `6c0c618`, na branch `claude/jovial-ardinghelli-03da7a`, ainda sem merge aqui.

## Limpeza

- **Removidos:** clientes, assinaturas e relógios de teste, e cupons. A conferência final deu 0 de cada. O banco da homologação é apagado ao fim de cada rodada (L-050).
- **Mantidos no sandbox:** os preços novos do catálogo (anual e adicionais), que o app reutiliza pela chave de busca.

## O que continua sem homologar

- **Webhook nativo:** os eventos foram assinados localmente com o segredo real, apontando para objetos reais. O app relê tudo do Stripe, e a rota nativa foi homologada no 06A-H, mas ela não recebeu estes novos eventos, porque isso exige um túnel público.
- **Boleto:** não é possível reproduzir o vencimento pelo roteiro. A regra está só na simulação.
- **Compra de adicional depois de uma troca de ciclo:** o relógio simula um período futuro e a prévia usa a hora real, que o Stripe recusa. Só a redução foi exercitada nesse estado. Em uso real os dois relógios coincidem.
- **Cupom com `applies_to`, `redeem_by` ou `max_redemptions`:** evite usá-los até conferir.
- **Telas:** o diálogo de revisão de adicional e a redução não foram exercitados pela interface; o roteiro chama o serviço.
- **Runtime em execução:** roda o código antigo até ser reiniciado.
- **Cobrança live:** continua desabilitada e pertence ao 08B.
