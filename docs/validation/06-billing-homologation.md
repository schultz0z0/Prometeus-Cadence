# 06A-H — ciclo financeiro homologado em sandbox

26/10/2026. Execução nativa em `codex/billing-06`, conforme o [plano06A-H](../superpowers/plans/2026-10-26-prometeus-cadence-06ah-billing-homologation.md). **Concluído no escopo abaixo.** Nenhuma cobrança live ou contratação na referência. Próximo pacote: **06C.1 — eventos e desempenho**.

## Resultados externos próprios

Dois workspaces QA isolados, identidade fictícia e cartões de teste. Conta Stripe sandbox conferida antes de cada operação; chave live/objetos live são recusados. A assinatura original da Agência Prometeus permaneceu Essential ativa, com mesma assinatura, vencimento e renovação habilitada.

| Cenário | Prova e resultado |
|---|---|
| Contratação Essential | Preparação/confirmação autenticadas, Checkout real com cartão fictício, retorno ao app e eventos assinados. Antes do pagamento não havia direito; depois, assinatura ativa e franquias corretas. |
| Pacotes pré-pagos | Checkout pago de2.000 extrações/R$97 e5.000 importações/R$27. Exatamente uma concessão por compra. Repetir a confirmação da mesma operação preservou os saldos, sem duplicar créditos. |
| Checkout expirado sem pagamento | Sessão real expirada pela API no segundo workspace, em tempo real. Evento nativo processado, operação falhou e zero crédito adicional concedido. |
| Forma de pagamento | Portal aberto pelo fluxo revisado do app. Cartão fictício alterado para Mastercard final4444; default efetivo confirmado no customer Stripe. Configuração restrita a pagamento/histórico, sem troca/cancelamento de assinatura fora do app. |
| Upgrade | Essential→Pro, diferença proporcional deR$483,79 paga. Plano remoto/local convergiu para Pro. |
| Downgrade | Pro→Essential agendado para renovação, preservando Pro até o prazo. Renovação simulada pelo Test Clock aplicou Essential e removeu a mudança pendente. |
| Falha e recuperação | Renovação com método oficial de teste de recusa gerou `past_due`. Troca para cartão fictício válido e pagamento da fatura restauraram `active`. |
| Cancelar e retomar | Cancelamento no fim do período; popup real de retomada sem cobrança imediata; confirmação na UI e na Stripe, ambos com renovação retomada. Quantidade de faturas permaneceu igual. |
| Encerramento e recontratação | Cancelamento efetivo por avanço do relógio QA bloqueou novas execuções. Novo Checkout próprio restabeleceu a assinatura; repetição de cancelar/retomar foi conferida até convergência local. |
| Limpeza | As duas assinaturas QA foram efetivamente encerradas;2.000/5.000 créditos comprados continuaram preservados. A função SQL de execução rejeitou o workspace cancelado. |

Ao final: **44 eventos nativos assinados recebidos, todos `done`, zero pendência** nos dois customers QA. Cinco faturas reais de teste ficaram visíveis na interface de histórico do workspace principal. Os eventos gerados pelo relógio são eventos reais do sandbox; o tempo avançado é virtual e exclusivo do cliente QA.

Duplicação/fora de ordem, falha de upgrade, lease/revisões, isolamento e resultado remoto incerto também estão cobertos pelos testes de integração. Não se alega redelivery manual de um evento nativo: houve replay real da confirmação do app e cenários de eventos repetidos/fora de ordem em testes isolados.

## Correções produzidas pela homologação

- A Stripe recusava a criação do schedule de downgrade porque `metadata` era enviado junto de `from_subscription`. A criação agora envia somente a assinatura; a identificação da operação é persistida com as fases na atualização seguinte. Recuperação após resposta perdida usa a mesma chave idempotente, validando posse, customer, assinatura e fases. Schedules de outra operação são recusados antes de qualquer POST.
- Completado o caminho de **Retomar renovação**, incluindo revisão, operação durável, autorização/guardas SQL, idempotência, adapter e botão na aba Cobrança. Migração aditiva075 aplicada localmente.
- **Forma de pagamento** permanece disponível em `past_due`/`attention`, permitindo corrigir o método durante a recuperação. Cancelar/retomar continua limitado aos estados elegíveis.
- Portal sandbox ausente e endpoint temporário inacessível foram reconfigurados. A versão Stripe já fixada, `2026-09-30.endive`, foi preservada. O plugin Stripe não estava exposto no catálogo desta execução; foi reutilizada a API com a chave test já autorizada.

## UI e validação técnica

As três abas foram exercitadas com dados reais de QA em1920×1080,390×844 e320×844: nove casos sem overflow horizontal e sem erro JavaScript. Popup de revisão de pacote em390px ficou dentro do viewport, abriu e foi cancelado sem criar pagamento. Popup de retomada foi confirmado pelo navegador e seu resultado financeiro foi conferido pela API. Histórico populado e retorno de Checkout/portal também foram observados.

Evidência sanitizada: [desktop](evidence/06ah/1920-plan.png), [cobrança mobile](evidence/06ah/390-billing.png), [plano320px](evidence/06ah/320-plan.png) e [conferência financeira](evidence/06ah/financial-proof.json). RES reutilizado para mascarar dados das capturas. Layout aprovado de plano/cobrança preservado; estados pagos da referência continuam **não observados**, conforme decisão anterior do usuário. Esta entrega não declara paridade visual100% desses estados nem do produto inteiro.

- Unitários completos: **266/266**; `.runtime/m06h-unit.log`.
- Integração completa: **271/271**; `.runtime/m06h-integration-full.log`. Recorte de billing:34/34.
- Contratos de schedule/adapter:5/5, incluindo recuperação de resposta perdida e rejeição de schedule alheio.
- Build Next concluído e checagem TypeScript posterior sem erros; `git diff --check` sem erros.
- Revisão independente final realizada. O achado sobre rejeição de schedule alheio foi resolvido preservando o teste de segurança existente, sem relaxar sua expectativa.
- Aplicativo local e seis lanes ativos, sem falhas na conferência. Túnel encaminha exclusivamente o webhook; assinatura ausente é recusada e outras rotas não são expostas.

## Limites e encerramento das fixtures

Test Clocks avançaram meses apenas no cliente QA. O relógio do computador/servidor não foi modificado. Franquias geradas em períodos virtuais futuros não são evidência de consumo disponível no tempo real: o SQL mantém a guarda de início/fim do período. A agregação visual desse cliente artificial pode mostrar concessões que ainda não venceram pelo relógio real; por isso as capturas de quotas usam o segundo workspace, sem relógio virtual. Unicidade/expiração/reserva/consumo em tempo real permanecem verificadas na suíte isolada; não se enfraqueceu a guarda de produção para acomodar a fixture.

Registros financeiros e fixtures vazias foram retidos para auditoria. Ambas as assinaturas QA estão canceladas; trial do segundo workspace foi encerrado explicitamente na limpeza, sem tratá-lo como prova de expiração natural. A sessão QA foi revogada e apenas sua janela de navegador foi fechada. Nenhum contato, cadência ou envio foi criado no piloto.

Segredos, cookies, URLs opacas de Checkout/portal e helpers permanecem privados em `.runtime/`/`.env.local`; não fazem parte das evidências públicas. O túnel HTTPS é temporário: se recriado, a URL do webhook precisará ser atualizada. Isso segue como infraestrutura local de homologação; endereço permanente/produção pertence ao08B.

**Nenhuma ação manual é necessária do usuário para concluir06A-H.** Anual, cupom, capacidade adicional e executores ainda pendentes continuam06G e seus marcos funcionais; cobrança live não foi habilitada.
