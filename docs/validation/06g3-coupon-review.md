# Revisão final — 06G.3

04/11/2026. A revisão foi feita por um subagente independente, somente leitura, sobre a mudança antes do commit. Não encontrou Critical nem High, e os controles antifraude se sustentaram. Encontrou três Medium e oito Low, além de lacunas de teste. As regressões marcadas abaixo falhavam antes da correção. Nenhuma correção precisou mudar o banco.

| Achado | Correção | Regressão |
|---|---|---|
| Medium M1: boleto vencido prendia o uso para sempre | Pagamento que caducou encerra a operação e devolve o uso, pelo evento ou pela leitura periódica; pagamento em processamento mantém | Vencido libera, em processamento mantém (falhava) |
| Medium M2: checkout abandonado segurava o código por até 24 h | Sessão com cupom expira em 1 h, calculada pela criação da operação para a repetição enviar o mesmo pedido | `expires_at` igual na repetição; sem cupom não muda (falhava) |
| Medium M3: cupom alterado depois da revisão podia cobrar outro total e não dar créditos | O worker relê o cupom antes de criar a sessão; se o total mudou, falha e devolve o uso | Nenhuma sessão criada, uso devolvido (falhava) |
| Low L1: cupom apagado no Stripe respondia diferente e revelava que o código existe | 404 do Stripe vira a mesma recusa | Mesma resposta (falhava) |
| Low L2: script do operador perdia o último dia, aceitava data passada e opção errada, e sobrescrevia em silêncio | Formato AAAA-MM-DD no horário do Brasil, recusa de erros, `--update` explícito | Script (falhava) |
| Low L3: uso preso em operação incerta só saía por SQL | `--release`, depois de conferir no Stripe; uso consumido não sai | Script (falhava) |
| Low L6: código continuava no campo depois da compra; dica sem vínculo; campo ativo sem poder comprar | Limpa ao surgir nova operação, `aria-describedby`, travado quando a conta não pode comprar | Leitura do código; o estado travado não foi visto no navegador |
| Lacunas de teste | Adulteração de `coupon` e `couponId` com o erro exato, reembolso, operação incerta, repetição e concorrência no mesmo workspace | Testes novos |

## Aceitos sem mudança

- **Low L4 e L5:** o texto da referência é "Aplicado ao pacote que você contratar". Usamos "Aplicado ao pacote de créditos que você comprar", porque aqui o cupom não vale para adicional recorrente. Com o campo preenchido, "Contratar" um adicional segue sem desconto, e a revisão mostra o preço cheio antes de cobrar.
- **Low L7:** mudar `BILLING_VERSION` ou a origem com uma operação em andamento faz a repetição falhar no Stripe. É um cuidado de deploy.
- **Low L8:**
  - o id do cupom no Stripe vai ao cliente depois de um código válido; é assinado, então não pode ser trocado;
  - um uso por workspace pode ser multiplicado criando workspaces em teste, então o limite real da campanha é `max_uses`.
- **Regra SQL `offer.kind<>'pack'`:** é uma segunda barreira que só uma prova forjada alcançaria, e continua sem teste próprio.
- **Limite de requisições:** existe na rota HTTP, mas os testes chamam o serviço direto. Está coberto pela leitura do código.
- **Formato real da sessão do Stripe:** as fixtures são escritas à mão, então isso fica para a homologação.
