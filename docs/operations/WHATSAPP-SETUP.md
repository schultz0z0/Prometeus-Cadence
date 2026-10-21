# WhatsApp 05A · operação e piloto

O aplicativo, o worker de prospecção, o scheduler de automações e o worker de mensagens são processos separados. O aplicativo **não inicia envios ao subir**. Meta Cloud API e Twilio usam credenciais de cada empresa, salvas em **Configurações → WhatsApp**. Google OAuth de login é independente desta integração e não é necessário para o piloto WhatsApp.

## Estado desta entrega

Código e testes locais cobrem os dois provedores. O aceite real Meta e o aceite real Twilio permanecem pendentes de conta, credenciais, callback HTTPS e destinatário autorizado. A versão candidata da Graph API é **v26.0**: uma rejeição do provedor é erro explícito; não existe fallback silencioso de versão ou de provedor. E-mail pertence ao marco05B.

## Infraestrutura local

Execute `rtk npm run env:init`, `rtk npm run db:up` e `rtk npm run db:migrate`. Não apague os volumes. O provisionamento adiciona dois papéis PostgreSQL sem superusuário/bypassRLS: `cadence_ingress` autentica e persiste eventos técnicos por funções restritas; `cadence_dispatcher` opera a outbox e os recibos por funções restritas. As URLs `INGRESS_DATABASE_URL` e `DISPATCH_DATABASE_URL`, suas versões `TEST_…` e as senhas são geradas em `.env.local` ignorado pelo Git.

`CHANNEL_KEYRING_JSON` mapeia IDs para chaves AES-256 de32bytes em base64. `CHANNEL_ACTIVE_KEY_ID` seleciona a chave de escrita. Credenciais são cifradas com contexto de workspace/conexão/provedor/revisão. Faça backup seguro do banco **e de todas as chaves referenciadas**; restaurar somente o banco não recupera os canais. Para rotação, adicione uma chave ao keyring, altere a ativa, reinicie os processos e salve cada conexão para gerar outra revisão. Preserve as chaves antigas e as revisões de credencial necessárias aos callbacks/recibos em trânsito. Remover uma chave antiga antes de migrar seus registros torna essas credenciais ilegíveis. Não copie segredos para logs, commits, tickets ou chat.

Defina `CHANNEL_PUBLIC_BASE_URL=https://SEU-HOST` somente depois de preparar o ingresso público. É uma origem HTTPS sem caminho, usuário, senha, query ou fragmento. O app mostra o caminho local enquanto não houver origem pública; isso não significa que o webhook está pronto. A assinatura Twilio usa esta URL canônica, nunca headers de proxy para escolher a origem.

### Exposição HTTPS · preparação, ainda não aberta

Destino local previsto: **127.0.0.1:3210**, com HTTPS terminado em um proxy sob seu controle. Rotas públicas necessárias: `GET/POST /api/channel-webhooks/meta/:publicId` e `POST /api/channel-webhooks/twilio/:publicId/messages|status`. Mantenha os demais serviços Docker ligados apenas ao loopback. Não publique PostgreSQL, SMTP, ferramentas de desenvolvimento ou endpoints de manutenção. Uma exposição do aplicativo inteiro também torna login/cadastro acessíveis e precisa de configuração de produção própria.

Antes de abrir qualquer endpoint, escolha um hostname concreto e confira quais rotas o proxy encaminhará. Esta entrega não cria domínio, túnel, certificado, conta externa nem assinatura. Os próximos passos manuais ficam para a disponibilidade do usuário.

## Configuração da empresa no app

Proprietário/administrador pode salvar, verificar, sincronizar catálogo, configurar limites, registrar evidências e confirmar testes/publicações. Operador consulta estado e responde pela inbox; o servidor e o PostgreSQL validam o papel novamente. Cada workspace começa vazio. Nunca compartilhe uma conexão ou conta de provedor entre empresas para contornar o vínculo de propriedade.

1. Abra `/settings/whatsapp`, selecione Meta ou Twilio e salve identificadores e segredos. Campos de segredo em branco na edição preservam o valor salvo. Alterar a revisão exige nova verificação.
2. **Verificar credenciais** consulta conta, permissões e remetente. Não envia mensagem e não assina o aplicativo na WABA automaticamente.
3. Configure os callbacks no provedor. Challenge Meta comprova a URL; uma mensagem **assinada recebida e vinculada ao remetente verificado** comprova a entrada e libera o estado pronto. Um status isolado não fabrica uma janela de atendimento.
4. Sincronize o catálogo remoto. Só templates aprovados, na revisão atual e com parâmetros de texto suportados podem ser usados. Templates de escrita do rascunho são diferentes dos aprovados pelo provedor.
5. Salve limites explícitos por workspace e remetente. O fuso do limite diário é exibido. O intervalo compartilhado padrão é60–180segundos; não há promessa de ausência de bloqueio pelo provedor.
6. Prepare e revise um teste com seu número autorizado. Confirme somente depois de conferir o destinatário, a mensagem, a autorização e os bloqueios.

### Meta · passos manuais ao final

- Em [Meta for Developers](https://developers.facebook.com/apps/), crie/configure um aplicativo com WhatsApp e a conta empresarial. O piloto pode usar os recursos de teste disponibilizados nessa conta.
- Cole no formulário App ID, WABA ID, Phone Number ID, access token e App secret. O token deve pertencer ao aplicativo e à WABA verificados, com `whatsapp_business_management` e `whatsapp_business_messaging`.
- No painel Meta, configure a URL HTTPS exibida e o **verify token** revelado explicitamente pelo administrador. Assine o aplicativo na WABA e o campo `messages` dos webhooks. O app não realiza essa inscrição remota silenciosamente.
- Adicione e verifique seu próprio destinatário de teste no painel. Para o número de teste da Meta, pode ser necessário iniciar o exemplo `hello_world` pelo próprio painel Meta e responder pelo celular para comprovar a entrada. Esse bootstrap é manual e separado do envio piloto feito pelo Prometeus; o aplicativo não contorna a exigência de webhook recebido para ficar pronto.
- Tokens temporários podem expirar. A validade conhecida aparece no estado da conexão. Para uso continuado, configure credenciais adequadas à operação da empresa e verifique novamente.

### Twilio

Em [Twilio Console](https://console.twilio.com/), habilite um remetente WhatsApp. Informe Account SID, telefone internacional, modo de autenticação e credenciais. API Key SID/secret autenticam REST no modo API Key; o **Auth Token da conta permanece obrigatório para assinatura de webhooks em ambos os modos**. Messaging Service é opcional e seu pool precisa conter o remetente explícito. O adaptador usa Senders API **v2** e Content API; não usa QR/Z-API.

Configure callback de entrada e de status exibidos no app. O envio inclui seu callback de status e uma referência opaca da tentativa. Templates usam Content SID/ContentVariables, sem substituir arbitrariamente o corpo aprovado.

## Publicação, consentimento e atendimento

O rascunho pode ser gerado/editado sem ativar envio. Na cadência salva, selecione remetente, conteúdo por etapa e até500destinatários. Registre apenas evidência real de autorização de campanha. Telefone público, resultado Apify, qualificação por IA e resposta de atendimento **não criam consentimento de marketing**.

A revisão resolve variáveis por lead, mostra bloqueios e congela conteúdo, destinatários, contexto, produto, rota de IA, versões e limites. Confirmar ativa essa versão. Salvar outro rascunho não a altera. Pause explicitamente a publicação antes de publicar outra versão da mesma cadência. Feriados sem calendário, canais de e-mail/LinkedIn e opções ainda indisponíveis bloqueiam a publicação; não são silenciosamente ignorados.

Texto livre exige mensagem recebida autêntica há menos de24horas. Fora dessa janela, exige template aprovado e autorização da finalidade. A inbox aceita contatos sem empresa vinculada e identificadores opacos sem inventar telefone/lead. Marcar como lido só avança até a última mensagem exibida. Mídia é identificada; download/visualização do arquivo não faz parte deste piloto.

## Worker e manutenção

Sem `MESSAGING_WORKER_ENABLED=true` **e** `--allow-dispatch`, o worker não faz claims, consultas de provedor nem envios. Não foi habilitado nesta entrega. Para o piloto, depois da confirmação no app, use **o ID da mensagem revisada**:

```powershell
rtk npm run messaging:worker -- --allow-dispatch --once --workspace WORKSPACE_ID --message MESSAGE_ID --max-messages 1
```

Este modo não materializa outras cadências nem resolve timestamps de outros contatos; só tenta a mensagem indicada. Ele não é uma autorização para repetir uma tentativa incerta. Para operação recorrente, o operador pode escolher `--workspace ID` ou explicitamente `--all-workspaces`, sem `--message`; o máximo por tick é1–100. Sem `--once`, o loop continua atéSIGINT/SIGTERM. `dispatched` conta leases processados, não entregas/cobranças. O processo também resolve datas de entrada Twilio por REST; callbacks Meta já são aplicados no ingresso. Desligar o processo não recolhe um POST em andamento.

```powershell
rtk npm run messaging:maintenance -- --prune
```

A manutenção explícita expira somente body hash e metadados técnicos de ingresso com mais de90dias, em até10lotes de1000. Preserva histórico de conversa, recibos, evidências de status, vínculo de mensagens e chaves de deduplicação. Lookups de data ainda pendentes desses eventos antigos são encerrados, pois já não poderiam abrir uma janela atual. Não existe cron instalado automaticamente. DisponibilidadeDB ruim interrompe o processo com erro resumido, sem imprimir configurações/segredos.

## Resultado incerto e recuperação

Um timeout/perda da resposta após intenção de POST vira **incerto**. Não há reenvio cego, troca automática de provedor nem consulta Meta inventada por messageID. Reiniciar preserva tentativa e reserva. Um callback assinado pode reconciliar um recibo tardio inclusive após rotação/revogação. Resultado aceito consome uma unidade uma vez; resultado incerto mantém reserva. Custo monetário desconhecido permanece desconhecido, não zero.

Só rejeição comprovada pode agendar retry, com backoff persistido e no máximo3POSTs totais. Erro de autenticação não tenta novamente. Falha de entrega depois de aceitação não devolve consumo. Um administrador reconcilia na inbox com referência do painel e evidência concreta; na Meta é atestado humano, na Twilio um SID aceito também precisa corresponder à conta/remetente/destinatário por REST. Reconciliação não reenvia mensagem. Resposta, opt-out, supressão, pausa, alteração de revisão e perda de papel bloqueiam novos envios; um POST em andamento ainda pode terminar e seu recibo é preservado.

## Smoke opcional por API

O caminho recomendado para o piloto é a interface. `rtk npm run messaging:smoke` fica desligado por padrão. A ferramenta CLI só chama a origem HTTP **loopback** do app, com cookie local mantido no ambiente. Exige `WHATSAPP_SMOKE_ENABLED=true`, `SMOKE_WORKSPACE_ID`, `SMOKE_CONNECTION_ID`, `SMOKE_COOKIE`, `SMOKE_TEST_PHONE`, `WHATSAPP_SMOKE_ALLOWLIST` (arrayJSON contendo o telefone) e `WHATSAPP_SMOKE_INPUT_FILE` (arquivoJSON local ignorado).

O arquivo contém `requestId` UUID estável, `senderId`, `phone`, `content` e `consent:{source,occurredAt,evidence}`. Não contém token Meta/Twilio. `--prepare` exibe destinatário/prévia/bloqueios e salva a revisão assinada em `.superpowers/whatsapp-smoke-review.json`. Só `--confirm` com mesmo arquivo, escopo, destinatário permitido e revisão válida enfileira **uma** mensagem. Não inicia worker e não extrai credenciais dos provedores. Use depois o worker restrito ao ID retornado. O cookie e o arquivo de revisão nunca entram em Git/chat.

## Aceite real pendente

Quando conta/API/HTTPS estiverem prontos: validar credenciais e entrada, sincronizar um template, configurar limites pequenos, revisar um destinatário próprio autorizado e confirmar1mensagem. Executar o worker restrito a esse ID, conferir aceitação e callback de entrega, responder pelo telefone e comprovar que o follow-up pendente foi interrompido. Não usar contatos prospectados no piloto. Registrar resultados sem segredos. Este roteiro ainda não foi executado contra Meta/Twilio reais.

Referências primárias: [Meta WhatsApp Cloud API workspace](https://www.postman.com/meta/whatsapp-business-platform/overview), [Twilio Senders API](https://www.twilio.com/docs/whatsapp/api/senders), [Twilio Content API](https://www.twilio.com/docs/content/content-api-resources), [Twilio validação de webhooks](https://www.twilio.com/docs/usage/webhooks/webhooks-security).
