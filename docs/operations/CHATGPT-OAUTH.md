# ChatGPT OAuth direto — instalação local

Esta conexão é uma LLM convencional independente do adaptador Codex CLI. Não precisa de executável Codex nem lê credenciais de outros aplicativos. O acesso aos modelos e a cota dependem da autorização concedida pela conta ChatGPT.

## Conectar pelo aplicativo

1. Entre em `http://127.0.0.1:3210` e escolha o workspace correto como administrador.
2. Abra **Configurações → Provedores de IA**.
3. No cartão **ChatGPT · OAuth direto**, clique em **Conectar com ChatGPT**.
4. Entre na sua conta no domínio oficial da OpenAI e revise as permissões de identidade e uso dos modelos pelo plano. Volte ao app pelo retorno automático.
5. Confira a conta autorizada e o catálogo. Se desejar outro modelo, selecione-o e clique em **Salvar modelo**.
6. Em **LLM convencional**, selecione **ChatGPT · OAuth direto**. Escolha **Somente LLM convencional** para testar sem JEV, ou o roteamento automático aprovado. Clique em **Salvar configuração**.
7. Clique em **Testar LLM convencional**, revise a única chamada sintética e confirme. Acompanhe a execução pelo link exibido. Conectar a conta e consultar o catálogo não iniciam inferências.
8. Após o teste concluído, use os fluxos existentes de qualificação, resumo, contexto, público e cadências. Revisões e confirmações continuam obrigatórias nos mesmos pontos do aplicativo.

O modo automático usa a convencional sozinha quando o JEV não está configurado. Com JEV habilitado e configurado, exige um teste válido do acompanhante. JEV sozinho permanece bloqueado. Não há troca automática para OpenAI API ou Gemini se a cota do ChatGPT acabar.

## Operação

- Disponível apenas com `CADENCE_RUNTIME_MODE=local` e `BETTER_AUTH_URL` em HTTP com host exato `127.0.0.1`. O retorno é `/api/ai-oauth/chatgpt/callback` na mesma porta do app.
- A modalidade comercial hospedada permanece bloqueada: depende da habilitação própria documentada pela OpenAI. A integração local não demonstra essa habilitação.
- Registro dinâmico e identificador opaco persistente do host. Tokens e PKCE ficam cifrados por workspace em `.runtime/chatgpt-oauth/`, usando o keyring existente dos canais. Proteja essa pasta, `.env.local` e seus backups com as permissões da conta do sistema. Não copie tokens para o cliente ou para o Git.
- O PostgreSQL local deve estar disponível. Uma trava transacional por workspace, usando o papel existente `cadence_worker`, serializa conexão, alteração, desconexão e refresh entre processos. Nenhuma permissão adicional de banco foi concedida.
- A intenção de renovação é persistida antes de usar o refresh token rotativo. Se o processo cair nesse ponto, o app exige reconexão, sem repetir o token antigo.
- Trocar conta/conexão, modelo ou política invalida revisões e novas etapas preparadas com outra configuração. Renovar somente o token não invalida o modelo ou o teste.
- O catálogo não prova acesso efetivo ou saldo; o teste revisado verifica uma inferência. A cota pode ser compartilhada com outras aplicações da conta.
- Falha de permissão, revogação ou renovação exige reconexão. Catálogo indisponível preserva o registro e mostra atenção, sem habilitar geração. Desconectar remove os tokens locais e tenta revogar o refresh token remoto; o app informa se essa revogação não foi confirmada.
- O limite interno `codexCalls` é compartilhado pelos dois adaptadores do plano. O ledger diferencia o provedor `chatgpt-oauth` de `codex`; não há conversão inventada para dólares.
- A inferência usa Responses público com `store:false`, streaming, limites locais de tempo/bytes e validação dos resultados. Um stream incompleto não confirma sucesso. Não são expostas ferramentas extras nem navegação autônoma pelo fato de usar OAuth.

Fontes: [registro local/OSS](https://developers.openai.com/siwc/token-sharing-open-source), [autorização](https://developers.openai.com/siwc/sign-in), [modelos e inferência](https://developers.openai.com/siwc/models-and-inference), [limites da prévia](https://developers.openai.com/siwc/preview-limitations). Consulte também o [estudo do projeto](../research/2026-10-23-chatgpt-oauth-correction.md).
