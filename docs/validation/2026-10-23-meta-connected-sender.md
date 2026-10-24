# Meta: estado de conexão versus verificação OTP

## Causa e evidência real

O usuário salvou a conexão Meta de teste no app e recebeu “Serviço indisponível” ao verificar. A investigação usou as credenciais cifradas já salvas, sem copiar segredos para scripts ou logs, e apenas consultas GET à Meta.

Na Graph API v26.0:

- `/debug_token`: HTTP 200, token válido, App ID correspondente e permissões `whatsapp_business_management` e `whatsapp_business_messaging` concedidas.
- Consulta da conta WhatsApp: HTTP 200 e ID correspondente.
- Consulta dos números da conta: HTTP 200, remetente correspondente. Com campos explícitos, a Meta retornou `account_mode: LIVE`, `status: CONNECTED` e `code_verification_status: NOT_VERIFIED`.

O adaptador exigia OTP `VERIFIED` para considerar o remetente disponível. Isso rejeitava esse número de teste conectado. Não foi falha do curl fornecido pelo usuário nem incompatibilidade entre o exemplo v25.0 e as consultas v26.0; nenhuma chamada de envio foi executada.

## Correção

Solicitar explicitamente `status` na consulta dos números e exigir `CONNECTED` para disponibilidade da API. OTP e estado da conexão não são intercambiáveis. Não foi adicionada exceção por nome do número, prefixo telefônico, modo local ou configuração informada pelo cliente. Números desconectados, restritos, banidos ou sem estado continuam bloqueados, mesmo com OTP verificado. Verificações de aplicativo, escopos, vínculo à conta e remetente, validade do token e os bloqueios por webhook permanecem.

Erros conhecidos do provedor agora têm mensagens fixas úteis na interface, em vez de virarem indiscriminadamente 503 genérico. O mapeamento não retorna mensagens brutas, tokens ou respostas da Meta.

## Verificação

- Testes escritos antes da correção reproduziram a falta de consulta do campo `status`; aprovados depois da alteração.
- 8 testes direcionados de verificação, mapeamento de erros e adaptadores Meta/Twilio aprovados.
- `npm run typecheck`: aprovado.
- `npm run build`: compilação de produção aprovada; app local reiniciado com a correção.
- Suíte unitária completa sequencial: **231 testes aprovados**, nenhuma falha.
- Integração `whatsapp-connections whatsapp-http whatsapp-dispatch whatsapp-ingress`: **11 testes aprovados** em banco isolado, nenhuma falha.
- Revisão independente: nenhuma pendência importante; o revisor executou os mesmos 8 testes direcionados.
- A verificação real, após a correção, persistiu `credentials: true` e um remetente. Estado final **awaiting_webhook**, challenge e entrada ainda pendentes. Nenhuma mensagem enviada e nenhum template sincronizado durante esse diagnóstico.

A exposição HTTPS do webhook é a próxima etapa e não foi realizada como parte desta correção.
