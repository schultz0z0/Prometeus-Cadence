# Serviço de avisos

O feed e as preferências são privados por usuário e workspace. O processo `notifications` é supervisionado permanentemente, com lote limitado e espera progressiva em falhas. `runtime:status` inclui seu estado. A instalação não habilita avisos externos.

Configuração de infraestrutura é administrativa: `NOTIFICATION_SMTP_HOST`, `NOTIFICATION_SMTP_PORT`, `NOTIFICATION_SMTP_SECURE`, `NOTIFICATION_SMTP_USER`, `NOTIFICATION_SMTP_PASSWORD` e `NOTIFICATION_MAIL_FROM`. Em produção, configure `BETTER_AUTH_URL` com a URL HTTPS pública. SMTP externo exige TLS. Credenciais nunca pertencem à preferência do cliente ou ao corpo da requisição HTTP.

Somente após homologar o provedor em destino próprio verificado, habilite explicitamente `NOTIFICATIONS_DELIVERY_ENABLED=true`. O destino de e-mail vem da conta autenticada com e-mail confirmado. Telefone de cadastro sozinho não é prova de titularidade: avisos WhatsApp ficam pendentes de verificação e de transporte próprio, sem usar implicitamente o número comercial do cliente.

Uma entrega iniciada fica incerta antes de atravessar a rede. Uma resposta perdida não provoca reenvio automático. Confirmações técnicas podem ser preservadas após revogação durante a chamada; isso não devolve acesso ao workspace e não cria outra entrega. As preferências, o destino verificado, a associação e a conexão de origem são conferidos novamente no claim.

Períodos de silêncio adiam avisos e som; o feed permanece consultável. Resumos diário e semanal usam períodos locais completos e uma chave por período. A seleção semanal usa segunda-feira. Resumo mensal e eventos do SDR aguardam os respectivos contratos e produtores reais.

O navegador consulta o feed somente enquanto está visível e online, com intervalo de 15 segundos. O som precisa de gesto do usuário, ignora a primeira leitura e não reproduz o backlog ao retomar a aba. Marcar um aviso como lido não altera leitura remota de e-mail/WhatsApp.

O gate externo permanece separado do aceite local: capturadores de testes e leitura de histórico não demonstram entrega de um novo aviso por um provedor público.
