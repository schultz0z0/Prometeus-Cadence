# E-mail 05B: configuração e operação

Implementação local de Gmail OAuth e SMTP/IMAP, isolada por workspace. O app não inicia workers nem envia ao subir. Credenciais reais e o piloto externo ficam para o roteiro conjunto [CHANNELS-PILOT](CHANNELS-PILOT.md).

## Infraestrutura e contas

Execute `rtk npm run db:up` e `rtk npm run db:migrate`, preservando volumes. Use a chave AES gerada por `env:init`; faça backup do PostgreSQL e do keyring completo. O app usa `cadence_app`; sincronização e dispatch usam funções restritas de `cadence_dispatcher`, sem acesso livre às tabelas ou credenciais. Não compartilhe arquivos `.env.local`, cookies ou artefatos de revisão.

Cada empresa adiciona suas caixas em `/settings/email`. Operadores podem ler e responder; owner/admin configuram, verificam, autorizam e definem limites. Senhas SMTP/IMAP são campos de escrita: vazios preservam o segredo anterior. Salvar qualquer revisão invalida verificação, prova e baseline; refaça a sequência. Histórico existente é preservado. O endereço comprovado permanece reservado à conexão original para evitar reaproveitamento entre workspaces.

Gmail requer configuração de **infraestrutura** `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`. Cada empresa então autoriza sua conta Google no app; refresh/access tokens ficam cifrados no servidor. Não preencher esses tokens no ambiente global. O callback Gmail é `/api/mail-oauth/google/callback`; o callback de login Google, se configurado separadamente com `GOOGLE_CLIENT_ID/SECRET`, é `/api/auth/callback/google`. Ambos precisam de URI exata no Google Cloud. Meta usa os callbacks descritos em [WHATSAPP-SETUP](WHATSAPP-SETUP.md).

OAuth usa PKCE, state vinculado à sessão/workspace/revisão, expiração de 10 minutos, acesso offline e escopos Gmail `gmail.send` + `gmail.readonly`. A conta efetiva é obtida pelo profile. Revogação/invalid_grant exige reconectar; erro não causa troca silenciosa de conta. Em consent screen externo **Testing**, inclua os usuários de teste e confira a expiração dos refresh tokens aplicável ao projeto. Antes de oferecer publicamente, prepare domínio, política de privacidade, retenção/eliminação e a verificação de escopos restritos exigida pelo Google; o tratamento de dados Gmail pode também exigir avaliação de segurança. Não declarar aprovação pública enquanto pendente. Referências verificadas no [estudo 05B](../research/2026-10-21-email-05b-study.md).

SMTP exige TLS implícito 465 ou STARTTLS obrigatório 587. IMAP exige TLS 993. Certificados e SNI são validados; DNS é resolvido e fixado em endereço público. Hosts privados/locais, IPs reservados, TLS inválido e downgrades são recusados. Use usuário/senha próprios da caixa ou senha de aplicativo quando o provedor exigir. Informe os nomes exatos das pastas Entrada e Enviados. Sem pasta Enviados, a correlação de aceitação depende dos registros disponíveis, sem supor rejeição por ausência.

## Sequência no app

1. Adicionar a caixa. Gmail: autorizar Google; SMTP/IMAP: verificar autenticação. Essas ações não enviam.
2. Concluir a sincronização inicial. A baseline não dispara campanhas nem importa toda a caixa antiga.
3. SMTP/IMAP: preparar e confirmar a prova para o próprio endereço; transmitir somente essa mensagem, depois sincronizar a entrada para ler o nonce autenticado. Login SMTP sozinho não comprova posse.
4. Definir limites explícitos globais do workspace, do canal e da caixa, com intervalos. Contas não compartilham identidade ou quota entre workspaces; ambos os canais compartilham o teto agregado. Se os limites forem salvos após a primeira sincronização, clique em **Sincronizar agora** novamente para reavaliar o estado pronto. Um horário de sincronização preenchido com a caixa ainda em verificação pode indicar limites pendentes; confira os três tetos e os intervalos.
5. Registrar evidência real de consentimento para campanhas/testes; atendimento exige resposta humana coerente nesta thread. Não transformar prospecção em consentimento.
6. Revisar um teste, resposta ou publicação. Confirmar apenas enfileira. Sender, destinatário, assinatura, conteúdo e versões são revalidados antes do envio.

SPF/DMARC e DKIM (com selector informado) são observações DNS; não são garantia de alinhamento ou entrega. Configure os registros recomendados pelo seu provedor e valide o resultado no destinatário real. Nunca anunciar ausência de bloqueio ou entrega garantida.

## Processos e comandos

Padrões são seguros: `rtk npm run mail:sync`, `rtk npm run mail:smoke` e `rtk npm run messaging:worker` retornam disabled/skipped sem chamadas de provedor. A aplicação não liga esses processos automaticamente.

```powershell
# Habilitar MAIL_SYNC_ENABLED=true no ambiente somente após revisar as caixas.
rtk npm run mail:sync -- --allow-sync --once --workspace WORKSPACE_ID --mailbox MAILBOX_ID
# Contínuo: mesma seleção sem --once; intervalo de 60 segundos.
# Conjunto: MESSAGING_WORKER_ENABLED=true e MAIL_SYNC_ENABLED=true.
rtk npm run messaging:worker -- --allow-dispatch --allow-sync --once --workspace WORKSPACE_ID
# Piloto exato: não sincroniza/materializa outras mensagens; faça sync separado antes.
rtk npm run messaging:worker -- --allow-dispatch --once --workspace WORKSPACE_ID --message MESSAGE_ID --max-messages 1
```

Sync limita 10 caixas/tick, 100 mensagens e 5 páginas por caixa; `--max-mailboxes` e `--max-messages` só reduzem esses limites. Leases de 90s são obtidos imediatamente antes de cada conta, com heartbeat de 15s; a próxima execução fica pelo menos 60s adiante. SIGINT/SIGTERM interrompem novas contas; operações já em andamento terminam ou alcançam seus timeouts. Pendências são retomadas por cursor sem declarar frescor antes do lote completo. O dispatcher só lê e-mail com os dois gates de sync; publicação de campanha com sync vencido fica bloqueada.

Um erro de transmissão desconhecido vira **incerto**, mantém a reserva e não é repetido automaticamente. Somente rejeição comprovada permite retry limitado. Busca em Enviados exige Message-ID/remetente/destinatário exatos. Resultado vazio não prova que o provedor rejeitou; reconciliação manual registra evidência e nunca reenvia. Resposta humana e opt-out cancelam pendentes conforme o escopo; tentativa em andamento não pode ser recolhida. Hard bounce suprime o endereço; soft bounce segura a matrícula, e repetição pode pausar a caixa. Recuperação exige revisão explícita e nova sincronização, sem inventar frescor.

## Smoke revisado, sem disparo implícito

Depois do trabalho manual final, configure localmente `EMAIL_SMOKE_ENABLED=true`, `EMAIL_SMOKE_ALLOWLIST` com seu endereço, `SMOKE_TEST_EMAIL`, `SMOKE_WORKSPACE_ID`, `SMOKE_CONNECTION_ID`, `SMOKE_COOKIE` e `EMAIL_SMOKE_INPUT_FILE`. A origem só pode ser o app HTTP local. O arquivo JSON ignorado contém `requestId` e `messageId` UUID fixos, `expectedRevision`, `to`, `content:{kind:"email",subject,text,signature}` e `consent:{source,occurredAt,evidence}` reais.

`rtk npm run mail:smoke -- --prepare` salva revisão local sem enfileirar. Confira o preview. `--confirm` exige exatamente o mesmo arquivo, workspace/caixa, requestId e revisão ainda válida, e enfileira uma mensagem; não inicia worker. Retry usa o mesmo requestId. Não gere outro UUID para repetir uma confirmação cuja resposta se perdeu. Artefatos em `.superpowers` podem conter texto/endereço e links de revisão: mantenha-os locais.

## Dados e manutenção

Mensagens são texto inerte: HTML não executa, imagens remotas não carregam, anexos ficam apenas como metadados. Conteúdo limitado/ambíguo ou lacunas ficam em revisão e bloqueiam a thread. Um administrador pode abrir **Revisar bloqueio desta thread**, conferir a mensagem completa na caixa original e confirmar a revisão com justificativa. A ação exige a mesma revisão da caixa e a última mensagem do histórico, registra auditoria e libera somente essa thread. Recuperar a caixa e sincronizar novamente continuam necessários; novo conteúdo limitado volta a bloquear. No Gmail, mensagens acima do limite geram registro visível com headers limitados e checkpoint persistente, sem repetir o download em todos os ciclos. Não há rastreamento de abertura/clique/entrega/leitura pelo destinatário; API retorna null e a inbox informa indisponível. “Lido” no app é um cursor individual de usuário, não um recibo remoto.

`rtk npm run messaging:maintenance -- --prune` trabalha em até 10 lotes de 1000 registros por categoria. Remove tentativas OAuth expiradas (TTL10min), e após 90 dias elimina headers/DSN técnicos e metadados de ingresso. Preserva texto, classificação/decisões, Message-ID/references, histórico, dedup, cursores e auditoria. Sem `--prune`, não altera nada. Não elimina contas ou mensagens a pedido do usuário; um fluxo de eliminação/portabilidade e política pública precisa ser fechado antes da produção.
