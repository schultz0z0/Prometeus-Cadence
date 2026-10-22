# Piloto conjunto: tarefas manuais finais

05A/05B têm implementação e validação local. Contas reais ainda não foram validadas. Execute este roteiro quando estiver no computador, com destinatário próprio e autorização explícita para cada envio. Não envie tokens, senhas ou cookies no chat.

## Preparar as contas e infraestrutura

1. Escolher domínio/origem HTTPS pública e preparar TLS/ingresso. Nada foi publicado ou exposto automaticamente. Preencher `CHANNEL_PUBLIC_BASE_URL` somente depois disso.
2. Google Cloud: configurar consent screen e credenciais OAuth do aplicativo, usuários de teste e os callbacks exatos separados de login e Gmail. Inserir client secrets localmente no ambiente do servidor e reiniciar o app. Autorizar cada caixa dentro de Configurações → Contas de e-mail.
3. Meta Business: criar/configurar o app WhatsApp Cloud API, número de teste e destinatário permitido; obter App ID, App Secret, WABA ID, Phone Number ID e access token. No workspace, selecionar Meta e preencher os campos. Validar permissões/ativos e o webhook público, com verify token mostrado pela plataforma. Adicionar um template aprovado para conversas iniciadas pela empresa. Não assumir que acesso ao Meta Business já configura a API.
4. Twilio (opcional neste piloto inicial): configurar sender WhatsApp/sandbox, Account SID, API Key SID/secret e Auth Token próprios do workspace; validar callbacks e um Content SID aprovado. Meta será a primeira opção de teste, conforme escolhido.
5. SMTP/IMAP (se disponível): preencher a própria caixa, hosts TLS públicos, pastas e senhas no app; verificar envio/leitura, baseline e prova recebida. DNS SPF/DKIM/DMARC conforme o provedor. Ver [EMAIL-SETUP](EMAIL-SETUP.md) e [WHATSAPP-SETUP](WHATSAPP-SETUP.md).
6. Definir limites mínimos para um piloto, consentimentos reais e allowlists locais. Manter os demais workers/scheduler desligados. Nenhuma necessidade de contratar ou liberar saldo de prospecção para este teste de canais.

## Verificar um envio por vez

- Gmail: preparar mensagem para seu próprio endereço, revisar subject/texto/assinatura, confirmar uma vez e anotar o ID enfileirado. Executar o dispatcher pelo ID exato, sincronizar e conferir a mensagem na caixa real. “Aceita” exige recibo do provedor; entregar na caixa precisa de observação real, não de métrica inventada.
- SMTP: repetir com uma mensagem própria após concluir a prova. Registrar comportamento de STARTTLS/TLS e pasta Enviados. Não repetir uma tentativa incerta para descobrir se foi entregue.
- Meta: começar com o número de teste e template aprovado/consentimento adequado. Conferir assinatura do webhook, status da mensagem, responder do próprio WhatsApp e confirmar a entrada na inbox.
- Twilio: quando habilitado, o mesmo roteiro com sender/Content SID próprios. Não mudar de provedor para retentar a mesma mensagem incerta.
- Resposta: escrever uma resposta manual pela inbox; revisar destinatário, thread/references e assinatura. Confirmar uma vez e verificar no destinatário.
- Cadência mista: publicar versão revisada com remetente de cada etapa, evidência por canal e descadastro de e-mail. Responder antes da próxima etapa e confirmar o cancelamento dos pendentes nos dois canais; uma tentativa já transmitida pode terminar.
- Opt-out: abrir o link GET de descadastro sem alterar nada; confirmar o POST e verificar a supressão idempotente do e-mail. Testar o pedido explícito de parada no WhatsApp e a preservação dos consentimentos separados.
- Reconexão: revogar/desconectar a caixa, confirmar bloqueio, reconectar/reverificar e sincronizar antes de retomar. O histórico deve permanecer. Não criar novo preparo para contornar incerteza.

Registrar por provedor: data, workspace, conexão/mensagem, estado observado, IDs técnicos redigidos quando necessário, resposta/cancelamento e evidência. Atualizar o relatório05B somente com o que realmente foi observado. Finalizar desligando workers/gates e removendo cookies locais de smoke. O teste conjunto não aprova automaticamente operação em massa ou produção pública.
