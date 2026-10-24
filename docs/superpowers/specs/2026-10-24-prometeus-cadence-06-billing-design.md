# Marco06A — assinatura, franquias e pacotes pré-pagos

Data:24/10/2026. Estado: proposta concreta para revisão; implementação ainda não iniciada. Decisões recebidas: Stripe em teste; mensalidade com pacotes de consumo pré-pagos; catálogo pode seguir a referência; execução nativa nesta conversa.

## Intenção

Transformar a tela demonstrativa de plano em cobrança real de teste, com direitos do workspace calculados no servidor. O usuário deve entender o que contratou, quando renova, quanto pode usar e quanto possui em pacotes. Dashboard, API, jobs e canais devem obedecer à mesma franquia. O redirecionamento do checkout não concede acesso sozinho.

A auditoria do marco06 e as correções posteriores estão em `docs/validation/06-reaudit.md` e no roteiro revisado. A infraestrutura de identidade, reservas de provedor, mensagens e runtime será reaproveitada. Não reimplementar e-mail/OpenWA nem tratar custos internos de IA como fatura do cliente.

## Abordagens e escolha

1. **Stripe Checkout hospedado + ledger local de direitos/consumo — recomendação técnica.** Preserva a interface de plano e deixa pagamento/cartão no Stripe. O servidor aplica plano, capacidade e créditos após eventos verificados. Cabe à arquitetura atual de PostgreSQL e workers.
2. Medição pós-paga com cobrança por excesso: foi descartada pela escolha do usuário por pacotes pré-pagos. Não gerar dívida variável automática.
3. Somente espelhar o estado do Stripe no frontend: insuficiente para jobs concorrentes, reserva de créditos e isolamento por workspace. Não será usado.

Stripe e o modelo mensal+pré-pago são decisões do usuário. Checkout hospedado, detalhes transacionais e políticas conservadoras abaixo são propostas técnicas desta revisão, não decisões comerciais já aprovadas.

## Catálogo proposto

Adotar os valores observados como catálogo inicial de teste, em BRL/centavos, versionado e administrado no servidor:

| Direito | Essential | Pro |
|---|---:|---:|
| Mensalidade | R$397 | R$897 |
| Extrações/mês | 5.000 | 8.000 |
| Importações/mês | 5.000 | 15.000 |
| Caixas de e-mail | 3 | 5 |
| Números WhatsApp | 2 | 3 |
| Assentos | 2 | 3 |
| Cadências ativas | 100 | 100 |
| Automações ativas | 50 | 50 |
| Templates / leads armazenados | Sem limite comercial declarado; limites técnicos continuam | Igual |
| Enriquecimento | 50 créditos/mês | 50 créditos/mês |
| LinkedIn | Sem módulo incluído | 1 conta |
| SDR | Não incluído | 300 conversas padrão/mês |

Preços anuais observados: R$3.811,20 Essential e R$8.611,20 Pro. Podem constar do catálogo versionado, mas a primeira homologação será mensal; ativação da modalidade anual exige os mesmos testes de quotas mensais e cancelamento. Nenhum módulo ainda não implementado deve ser apresentado como operacional: indicar disponibilidade da entrega correspondente ou bloquear sua contratação separada.

Pacotes **de compra única**, propostos com os tamanhos/valores da referência:

| Unidade | Pacotes |
|---|---|
| Extrações | +2.000/R$97; +5.000/R$219; +10.000/R$399 |
| Importações | +5.000/R$27; +10.000/R$47; +50.000/R$147 |
| Enriquecimento | +50/R$65; +100/R$120; +300/R$330 |

Diferença deliberada: na referência esses adicionais são recorrentes; aqui são compras únicas, sem renovação automática, não expiram e são usados depois da franquia. A tela e o resumo do checkout devem dizer isso. Pacotes de um recurso só ficam compráveis quando o recurso estiver operacional — enriquecimento permanece indisponível até06B. Nunca vender um saldo sem executor funcional.

Assentos/caixas/números extras são capacidade, não créditos consumíveis. Nesta primeira entrega, limitar aos direitos dos planos e não vender capacidade extra avulsa. Uma ampliação recorrente posterior precisa ter preço e vigência próprios, sem criar direito vitalício por uma compra pré-paga. Não adicionar taxa obrigatória de implantação, benefício de CRM externo, cupom promocional ou pacote SDR ainda sem política aprovada.

## Ciclo de vida comercial

- Preparação antes do trial: permitir configuração e rascunhos, sem execução externa comercial.
- Trial proposto:14 dias por workspace, uso dos direitos Essential, sem reinício por novo login/checkout. Ativação explícita pelo proprietário. Sem cartão, encerrar trial em estado de acesso restrito para novas execuções; não gerar cobrança inesperada.
- Compra: proprietário/admin com permissão de cobrança revisa plano, ciclo, preço e moeda. O servidor cria uma intenção local e uma sessão Stripe vinculada ao workspace/usuário/catálogo.
- Ativação: assinatura paga e estado elegível confirmados por leitura/evento Stripe. Retorno da página mostra “confirmando pagamento” até sincronizar; nunca confiar em parâmetros da URL.
- Renovação: uma concessão por período pago, sem duplicar com replay de evento. Franquias de extração/importação renovam em janelas mensais ancoradas na contratação, mesmo em plano anual. Enriquecimento mensal usa dia1 do calendário conforme referência; saldo comprado é separado. Mostrar relógios/datas distintos.
- Falha de pagamento: mostrar ação necessária e preservar dados. Bloquear nova execução comercial quando não houver direito válido; não apagar leads/canais. Não implementar multas, cobrança judicial ou política jurídica copiada da referência.
- Cancelamento: confirmar efeitos; desativar renovação ao fim do período pago, manter acesso concedido até lá. Não apagar dados nem remover créditos comprados. Após expirar o plano, preservar saldos consultáveis, mas novas operações exigem assinatura válida.
- Troca de plano: prévia explícita do efeito e valor. Upgrade só concede diferença após pagamento confirmado; downgrade fica para próxima renovação. Nunca truncar dados ou desconectar número automaticamente porque o plano ficou abaixo da capacidade usada; bloquear novas criações/ativações e orientar regularização.
- Reembolso/contestação: registrar evento e conciliar direitos do pagamento correspondente. Não criar saldo negativo silencioso nem recuperar consumo já feito por meio de cobrança automática; reservar revisão operacional para valores já consumidos.

Essas políticas são propostas do Prometeus. O comportamento jurídico/comercial do concorrente não é adotado automaticamente. Em particular, nenhuma cobrança real será ativada durante este marco.

## Direitos, quotas e concorrência

Separar três camadas:

1. Catálogo comercial e assinatura: plano/ciclo/status, vigência, direitos de capacidade.
2. Franquia e saldo pré-pago: unidade, lote de concessão, origem, período, consumo/reserva/liberação/estorno.
3. Orçamento interno de provedor: candidates/apifyRuns/apolloPages/LLM, tokens e custo conhecido/desconhecido. Mantém os guardas já existentes e não vira crédito de cliente por aproximação.

Proposta para unidade de extração/importação:1 novo lead aceito no workspace; duplicata rejeitada não consome franquia novamente. Preparação reserva o teto revisado; inserção idempotente consome os aceitos e libera o restante. O aceite06A deve confirmar essa política e exibir a contagem antes da execução.

Cada mutação sensível consulta direitos dentro da transação: criação/ativação de canal, convite/aceitação de membro, ativação de cadência/automação, importação e inserção por job/API. Não basta esconder botão. Dois jobs concorrentes não podem ultrapassar saldo pela leitura do mesmo total.

Ledger imutável com IDs de operação e concessão únicos, transação/lock por workspace+unidade+janela e vínculo do evento comercial ao Stripe. Reprocessar tentativa não duplica consumo. Reserva de resultado incerto permanece retida até conciliação; cancelar não libera consumo já confirmado. Capacidade diária de mensagem e limites específicos OpenWA continuam mais restritivos que qualquer pacote comprado.

## Integração Stripe e dados

Contratos novos: catálogo/entitlements/uso, preparar+confirmar checkout, consulta de intenção, histórico de faturas/contato, prévia/troca/cancelamento e webhook. Identidade vem da sessão/principal; nunca aceitar workspace/customer/preço arbitrários do navegador.

Tabelas lógicas: billing_customer, billing_subscription, billing_operation, billing_event_inbox, billing_grant, entitlement_ledger, entitlement_reservation e billing_invoice. Todas com ambiente de teste/produção e isolamento do workspace; eventos externos entram por chave Stripe autenticada e customer previamente mapeado.

Webhook valida assinatura sobre bytes originais, registra evento único e responde após persistência durável; processamento e reconciliação podem ser assíncronos. Eventos repetidos/fora de ordem não retrocedem uma assinatura nem concedem pacote duas vezes. Comparar estado atual do objeto, período, moeda, valor e catálogo esperado, em vez de presumir ordem de chegada. A chave idempotente do Stripe complementa o registro local; não cobre indefinidamente tentativas antigas.

Processo interrompido depois do Stripe aceitar e antes do commit local deve recuperar a mesma intenção. Operações incertas não criam nova sessão/cobrança automaticamente após expirar a janela de idempotência do provedor. Consulta/reconciliação precisa resolver o resultado antes de nova compra.

Dados de cartão permanecem no checkout hospedado. Salvar somente identificadores, datas, status, valores e links de fatura estritamente necessários; nada de chave/token no navegador ou log. Contato de cobrança não altera email de login. URLs de retorno são de origem configurada e não redirecionamentos livres.

## Migração e runtime

Não cobrar retroativamente jobs/leads antigos. Registrar corte de medição e direitos dos workspaces existentes explicitamente. O workspace de homologação pode receber concessão local de piloto, auditada e identificada como piloto; não inventar pagamento Stripe nem iniciar assinatura do usuário por migração.

Runtime permanente existente ganha processamento/reconciliação de billing com concorrência, intervalo, backoff e desligamento configuráveis. Polling do app usa cache/bounded refresh, visibilidade e invalidation; atualizar uso não desmonta formulário ou rascunho. Nenhuma janela de terminal visível deve surgir.

Em sandbox, chave live é rejeitada para este piloto. Ausência de credenciais mostra configuração pendente e mantém testes por adaptador fake; nunca afirma integração real. Deploy/ativação live, conta comercial, produto fiscal e piloto financeiro não estão autorizados automaticamente por este desenho.

## Interface

Manter três abas: Meu plano, Cobrança, Planos e pacotes. Mostrar status verdadeiro, próxima renovação, quotas e saldo comprado em linhas separadas. Catálogo com total e periodicidade claros. Contratar, comprar pacote, alterar plano e cancelar abrem popups de revisão; detalhes técnicos não poluem o fluxo.

Estados: carregando, sem assinatura, trial, ativo, aguardando pagamento, ação necessária, cancelamento agendado, encerrado, sem credenciais e falha temporária. Distinguir zero, desconhecido e indisponível. Após pagar, não exibir sucesso antes de concessão reconciliada.

## Aceite

1. Dois workspaces e papéis distintos: nenhum dado/checkout/direito cruzado; membro sem permissão não altera cobrança por API.
2. Preço/moeda/catálogo manipulados no navegador rejeitados.
3. Evento inválido rejeitado; válido duplicado e fora de ordem não duplica concessão ou apaga estado mais novo.
4. Pagamento pendente/falhado ou retorno forjado não concede crédito; pagamento confirmado concede exatamente uma vez.
5. Renovação, trial expirado, cancelamento agendado, downgrade e capacidade excedida preservam dados e aplicam a vigência correta.
6. Dois jobs/importações simultâneos respeitam saldo; duplicata não debita; resultado incerto permanece reservado até revisão.
7. Uso de provedor e consumo comercial ficam distintos; custo desconhecido continua desconhecido.
8. Compra de pacote consumível é única e não renova; saldo sobrevive à janela mensal. Reembolso/replay não cria crédito fictício.
9. Quotas de canal/membro/cadência/automação são verificadas nos caminhos reais de comando e no worker, não só na tela.
10. Migração preserva histórico/credenciais e marca concessão de piloto como local. Funcionalidade ainda ausente não é vendida como disponível.
11. Verificação de interface/rascunhos e runtime sem terminais visíveis. Reutilizar testes relevantes existentes; executar integração nova e build/types após implementação.
12. Piloto Stripe sandbox com credenciais próprias, prova de checkout e lifecycle por evento. Sem credencial, entregar implementação/testes e registrar piloto pendente, sem chamar marco homologado.

## Fontes e revisão

Catálogo e regras da referência: evidências EV-003/004/005/006/007/027/081 na auditoria. API privada não foi inferida como contrato obrigatório.

Base técnica: [eventos de assinatura](https://docs.stripe.com/billing/subscriptions/webhooks), [webhooks](https://docs.stripe.com/webhooks), [idempotência](https://docs.stripe.com/api/idempotent_requests) e [teste](https://docs.stripe.com/testing). Políticas de concessão, reserva, capacidade e migração acima são decisões propostas para nossa arquitetura.

Revisão nativa de construtibilidade: os principais pontos de integração foram identificados no EV-082. Enriquecimento, capacidades extras, annual e recursos07 não serão habilitados comercialmente antes de seus executores/aceites. Questões comerciais ainda abertas estão registradas na auditoria, sem bloquearem documentação nem justificarem cobrança presumida.
