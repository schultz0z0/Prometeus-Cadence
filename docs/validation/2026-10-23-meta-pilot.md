# Piloto Meta Cloud API — 23/10/2026

Ambiente local, número de teste fornecido pela Meta e destinatário próprio autorizado. Horários em America/Sao_Paulo. Segredos e conteúdo privado não são incluídos neste registro.

- Credenciais e cinco templates reais verificados. Limites explícitos de 20 mensagens/dia por workspace e remetente.
- Aplicativo inscrito explicitamente na WABA; inscrição confirmada por GET. Ingresso HTTPS temporário libera somente GET/POST no caminho desta conexão Meta. Login e endpoints de sessão retornam 404 pelo ingresso público; callbacks sem autenticação válida são recusados.
- Às 21:41:06, uma mensagem real do destinatário foi autenticada e persistida. A conversa e a mensagem com estado `received` foram confirmadas pelas APIs da inbox. A conexão ficou pronta com a entrada validada; o indicador de challenge da revisão 2 continua pendente.
- A resposta revisada e confirmada às 21:43:48 foi bloqueada localmente com `CREDENTIAL_OR_CALLBACK_UNAVAILABLE`. A tentativa continuava `prepared`, sem início, resultado ou identificador remoto. O dispatcher havia iniciado antes da configuração da origem HTTPS. A verificação com o ambiente atual passou para política, decifragem de credencial e URL; remover a origem reproduziu a falha do callback.
- Os serviços permanentes foram reiniciados. Foi retomada somente essa mesma mensagem confirmada, mantendo destinatário, conteúdo e provas. A recuperação exigiu bloqueio conhecido, zero transmissões anteriores e verificações atuais válidas, com registro de auditoria; as validações normais do dispatcher foram preservadas.
- Às 21:46:21 houve uma única transmissão. Às 21:46:22 a API aceitou a mensagem e retornou identificador remoto. Às 21:46:24 um webhook autenticado informou `failed`, código `130497`. O histórico foi atualizado para falha; não houve repetição do envio.

Resultado: conexão, entrada real, submissão de resposta e aplicação de status reais comprovadas. **Entrega de saída não homologada:** a Meta reportou restrição desta conta para o país do destinatário, inclusive na resposta de atendimento. A API de metadados retorna `account_review_status=APPROVED`; esse campo não comprovou elegibilidade para a entrega. Não se conclui uma proibição geral do ambiente de testes para números brasileiros. A causa específica da restrição exige diagnóstico da conta com a Meta.
