# Revisão final do marco06A

Revisão independente de `a63161f..55019e9`, somente leitura, seguida de uma rodada de correções pelo implementador. O primeiro revisor não executou por limite de uso; o revisor substituto forneceu os achados abaixo. Não houve delegação da implementação nem uma segunda rodada de revisão.

## Achados importantes

| Achado | Correção e prova |
|---|---|
| P1: recontratação paga não substituía assinatura cancelada | Transição vinculada ao Checkout aprovado, histórico das assinaturas substituídas e rejeição dos eventos antigos. Regressão cobre evento de assinatura chegando antes do evento de Checkout. |
| P2: upgrade expirado bloqueava cancelamento e outras mudanças | Identidade da fatura do upgrade persistida; fatura anulada encerra apenas aquela intenção. Renovação do plano anterior não conclui um upgrade diferente. |
| P2: downgrade podia sobrescrever um agendamento externo | GET autenticado verifica proprietário, assinatura, fases, preços, datas e estado antes de qualquer POST. Um agendamento alterado ou de outra operação é recusado. |
| P2: edição de contato alterava os parâmetros de um retry | Requisição inicial de criação do customer congelada antes do envio; atualização posterior vira operação separada. Regressão simula resposta perdida e alteração do contato. |
| P2: remoção do criador deixava créditos presos | Liberação privilegiada apenas quando o job e seus resultados estão resolvidos. Recebimento tardio e encerramento remoto confirmado também são cobertos; não depende da associação já removida. |
| P2: timeout ao abortar liberava a reserva antes da confirmação | Tentativa de abortar tem journal próprio. Incerteza mantém reserva e exige conciliação; uma solicitação aceita ainda em andamento é acompanhada por leitura. Liberação só após estado remoto terminal confirmado. |

As regressões falharam antes das correções e passaram depois. Implementação SQL em nova migração073;067–072 mantiveram seus checksums. A suíte completa, types/build e smoke local são registrados em [06-billing.md](06-billing.md).

## Menor adiado

P3: os40 grants de piloto da migração inicial não têm o evento inicial `grant` em `billing_entry`. Origem, quantidade, consumo e reservas permanecem em suas tabelas; nenhuma cobrança Stripe foi inventada. Falta um backfill idempotente para reconstruir o saldo inicial apenas pelo ledger. Este item ficou registrado para a correção de observabilidade/ledger; não afeta o prazo de7 dias nem permite gasto acima do saldo.

## Decisões registradas durante a execução

1. Usar o checkout limpo `codex/billing-06` no diretório atual, mantendo os caminhos do runtime. Custo: indisponibilidade breve do aplicativo no rebuild; nenhum merge ou push automático.
2. Prosseguir da aprovação do desenho para plano e implementação sem outra aprovação. Preços e trial seguem as decisões do usuário; custo de divergência: revisão do desenho, sem cobrança live.
3. Registrar briefs, RED/GREEN e commits diretamente no ledger no Windows em vez de executar wrappers bash. Custo: ausência dos artefatos automáticos desses wrappers; evidências de teste preservadas nos logs.
4. Confirmar usando o objeto de revisão assinado completo, com vínculo a usuário/workspace/revisão/sku/custo. Custo: o cliente envia o núcleo completo; não pode manipular seus valores sem invalidar a assinatura.
5. Separar migrações067–073 por persistência, operações, lifecycle, guardas, API e correções. Custo: mais arquivos sequenciais; nenhum checksum aplicado foi reescrito.
6. Permitir preparo de canais e assentos dentro da capacidade Essential antes do trial; execução e ativação comercial exigem direito vigente. Custo: infraestrutura limitada pode ser preparada antes do pagamento.
7. Fixtures antigas de comandos/prospecção ativam trial explicitamente; fixtures comerciais começam inativas. Custo: manutenção do preparo de testes; nenhum bypass de billing foi adicionado ao produto.
8. Resolver disputas sem customer por leitura autenticada, impedir trial após assinatura contratada e tornar o downgrade agendado visível. Custo: contestação exige revisão operacional para restaurar direitos; não há restauração automática silenciosa.
9. Declinado pelo revisor: homologação real do Stripe e aceitação da API/portal/3DS/webhook dependem das credenciais ausentes. Decisão: manter aceite financeiro pendente. Custo: nenhum pagamento real pode ser afirmado como validado.
10. Declinado pelo revisor: anual, enriquecimento, LinkedIn/SDR e venda de capacidade são entregas posteriores. Decisão: mantê-los indisponíveis como adicionais operacionais. Custo: catálogo inicial mais restrito.
11. Declinado pelo revisor: produção/live e regras fiscais/jurídicas não estão autorizadas neste sandbox. Decisão: não ativar live nem criar política jurídica por inferência. Custo: preparação própria antes de comercializar.
12. Manter a branch local no diretório atual após a entrega. Custo: integração/push não executados; o ambiente local usa os arquivos verificados desta branch.
