# 06C.3 — Notificações, preferências e resumos

**Execução:** 29–30/10/2026. **Estado:** implementação em validação; revisão final e aceite ainda pendentes. Não comprova entrega externa nem paridade integral com a referência.

## Implementação

Preferências e feed privados por usuário/workspace, com autorização atual no HTTP e no SQL, controle de revisão, replay exato e leitura idempotente. Abrir o sino não marca avisos automaticamente; marcar um aviso não altera leitura de e-mail/WhatsApp remoto. Nenhum corpo de mensagem ou credencial é copiado para a projeção.

Eventos confirmados de resposta humana, execução finalizada, falha de envio e atenção de conexão geram itens únicos. Respostas automáticas/DSNs não viram respostas humanas. O checkpoint acompanha a ordem de commit do feed operacional; a instalação não transforma o histórico anterior em backlog de avisos.

A fila técnica de entrega verifica associação atual, preferência, destino e conexão de origem antes de reservar a chamada. Silêncio adia avisos. Incerteza de rede não autoriza reenvio. Revogação durante I/O permite apenas guardar o recibo técnico, sem restaurar acesso ao workspace. O resumo diário/semanal usa o período local completo e fatos do relatório reconciliado, sem ler workspaces vizinhos.

O serviço supervisionado `notifications` usa lote e intervalo limitados. O navegador consulta a cada 15 segundos quando visível/online. Som exige gesto, não toca na leitura inicial e não reproduz backlog ao retornar à aba. Conta e Notificações consultam o mesmo serviço de preferências, preservando rascunhos durante atualização.

## Evidência e verificações

- Domínio: seis casos, incluindo todos os estados de autorização de entrega, silêncio 22–08, DST, semana completa e retomada sem som de backlog.
- PostgreSQL efêmero com papéis reais: nove casos de deduplicação, isolamento, leitura por usuário, origem/HTTP/revisão, revogação de associação/conexão, destino não verificado, incerteza e replay sem reagendamento. Apenas transporte externo usa capturador.
- Primeira suíte completa: 440/440 integrações e 361/361 unitários. Após a regressão adicional de replay: **441/441 integrações**, **361/361 unitários**, **9/9 focadas**, build de produção e tipos aprovados.
- Build de produção detectou assinatura incompatível no handler Next. Corrigido com wrapper explícito conforme a documentação instalada; build e tipos posteriores aprovados.
- QA real do navegador concluída: **34 capturas mascaradas, 21 pares de rota/viewport e 12 verificações de popup**, sem overflow ou pageerror nas rodadas. Persistência, revisão compartilhada com Conta, rascunho durante17s/pane de rede e recuperação, paginação30+5, leitura35→34 e foco/Escape verificados. Itens sintéticos de UI, quando usados, são identificados como tais e não demonstram entrega de provedor.

## Referência visual

Sessão salva dedicada do CadenceFlow reaberta somente para leitura. Seis capturas atuais de Conta/Notificações em 1920×855, 390×844 e 320×844. REA identificou o target e fez inspeção passiva sem textos de acessibilidade, fontes, conteúdo de rede ou valores de armazenamento. Nenhum toggle, campo, cobrança ou feed de notificações da referência foi alterado.

Cabeçalhos, painéis, switches, peso de fonte, botão Ouvir e linha do destino foram comparados e ajustados. Existem diferenças funcionais explícitas: a referência tem filtro de primeira resposta, inclusão durante conversa do agente e descarte fora de horário comercial. O contrato aprovado usa cada resposta e silêncio que adia; essas diferenças ficam registradas para auditoria de paridade/SDR, sem alegar igualdade integral.

## Limites e produção

Avisos externos permanecem desabilitados neste ambiente. SMTP de avisos é infraestrutura administrativa, com TLS externo e URL pública HTTPS; e-mail vem da conta confirmada. Telefone de cadastro não é destino WhatsApp verificado. Avisos WhatsApp aguardam prova de destino e transporte próprio. Eventos do SDR e resumo mensal não são anunciados como operacionais.

Configuração e política de incerteza: [operação](../operations/notification-delivery.md). O gate externo requer provedor e destino próprios verificados; capturadores locais não são evidência de entrega pública.

## Fechamento

Preferências, agenda e inbox anteriores restaurados exatamente. Somente os35itens sintéticos próprios foram removidos. Nenhum contato/canal/outbox criado; todas as sessões QA revogadas e os dois browsers próprios fechados. [Fechamento](evidence/06c3-notifications/closure.json). Curadoria somente leitura no workspace operacional comprova checkpoint em dia,0avisos/entregas/incertezas, sem replay do histórico e sem chamadas/envios. [Curadoria](evidence/06c3-notifications/real-data-curation.json). Pendente somente revisão independente, correções necessárias e atualização do roteiro pelo aceite real.
