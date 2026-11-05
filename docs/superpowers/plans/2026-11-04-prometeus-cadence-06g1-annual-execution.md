# 06G.1 — Plano anual e franquia mensal

04/11/2026. Primeira parte do [06G](2026-10-27-prometeus-cadence-06g-commercial-catalog.md). O 06G foi dividido porque cada parte mexe em um ponto do motor de cobrança:
- **06G.1 (este):** cobrança anual com 20% de desconto e franquia renovada a cada mês.
- **06G.2:** capacidade adicional (e-mail, WhatsApp, assentos, LinkedIn) como itens da assinatura.
- **06G.3:** cupom validado no servidor.

## Referência

EV-003, EV-004 e EV-005: seletor "Mensal / Anual -20%"; Essential R$ 317,60 e Pro R$ 717,60 por mês equivalente, cobrados R$ 3.811,20 e R$ 8.611,20 por ano. O trial de 7 dias e o consumo pré-pago continuam como decisões do usuário.

## Regras

- **SKUs:** `essential-annual` e `pro-annual`. A conta continua com `plan` em `essential` ou `pro`, mais `billing_interval`.
- **Preço:** só do catálogo do servidor; o cliente manda o SKU, nunca o valor. A Stripe precisa devolver a combinação exata de valor e intervalo, senão é divergência e nenhum direito é concedido.
- **Franquia:** o pagamento anual concede só a janela mensal corrente.
  - **Janelas:** cada mês conta a partir do início do período pago, com fim limitado a `period_end`.
  - **Virada:** `billing_roll_annual` abre a janela seguinte no ciclo de cobrança, sem chamar a Stripe.
  - **Não acumula:** o saldo de uma janela não passa para a seguinte. Pacotes comprados continuam sem expirar.
  - **Reembolso ou disputa:** revoga todas as janelas daquele pagamento.
- **Trocas:**
  - **Upgrade:** de Essential para Pro no mesmo ciclo, com cobrança proporcional depois de revisar.
  - **Downgrade:** de Pro para Essential no mesmo ciclo, na renovação.
  - **Troca de ciclo:** mensal ↔ anual no mesmo plano, sempre na renovação, sem cobrança agora, para não sobrepor franquias.
  - **Plano e ciclo juntos:** recusado; a pessoa faz em dois passos.
- **UI:** seletor Mensal/Anual na comparação, equivalente mensal e total anual, ciclo em "Meu plano" e texto da revisão.

## Persistência (111)

`billing_account.billing_interval`, as duas linhas do catálogo, índice de operação ampliado, `billing_month_window`, `billing_roll_annual` e `billing_apply_event` com a janela.

## Testes (RED primeiro)

- **Unitários:** SKUs, `planFromPrice` e `planChange`.
- **Integração:**
  - pagamento anual concede 1 janela (não 12), e repetir o evento não duplica;
  - a virada abre uma janela por mês, nada depois do período, e é idempotente;
  - valor ou intervalo divergente não concede;
  - reembolso revoga as janelas;
  - revisão de checkout anual, troca de ciclo aplicada na renovação limpando o agendamento;
  - combinação de plano e ciclo recusada; preço enviado pelo cliente recusado; operador recebe 403.
