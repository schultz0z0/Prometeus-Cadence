# Sincronização de templates: resultado JSON

## Causa confirmada

O botão de sincronização retornava HTTP 503 após a Meta devolver o catálogo corretamente. A consulta real ao endpoint `message_templates` retornou HTTP 200 com cinco templates aprovados. A função de sincronização persistia o catálogo, mas a etapa HTTP de registro do resultado da operação falhava.

`completeCommand` passava a lista JavaScript diretamente como parâmetro ao driver `pg`. O driver transforma arrays em arrays PostgreSQL, enquanto a coluna `app.command_result.result` é JSONB. A reprodução isolada de `SELECT $1::jsonb` com um array JavaScript confirmou erro `22P02` (`json_errsave_error`). Objetos simples de outras ações não reproduziam a falha, o que explica os testes de conexão anteriores passarem.

## Correção e regressão

Serializar o resultado explicitamente com `JSON.stringify` antes de enviá-lo ao PostgreSQL. Não altera os DTOs retornados ao cliente, as credenciais, limites ou regras de envio.

Teste de integração acrescentado em `whatsapp-http.test.ts`, usando a ação HTTP completa e apenas o GET Meta simulado:

- antes da correção: HTTP 503, reproduzindo o relato;
- depois: HTTP 200 com a lista, parâmetros e conteúdo esperados;
- repetição do mesmo request ID retorna a mesma lista do registro salvo, sem outra consulta ao provedor;
- catálogo vazio e sua repetição retornam `[]`, sem erro de serialização ou consulta repetida.

`npm run test:integration -- whatsapp-http whatsapp-connections mail-http mail-connections`: **15 testes aprovados**, nenhuma falha, em banco isolado. As suítes de e-mail também exercitam o registro compartilhado. `npm run typecheck`: aprovado.

Revisão independente sem pendências bloqueantes. `npm run build`: aprovado. Após reiniciar o app, a mesma ação HTTP real de sincronização retornou **HTTP 200 com cinco templates**, confirmando a correção no caminho usado pela interface.

Nenhuma chamada de envio de mensagem foi realizada nesse diagnóstico. O webhook público continua pendente; sincronizar catálogo não ativa o remetente nem uma campanha.
