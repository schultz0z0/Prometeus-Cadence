# 07C.3a — MCP autenticado: autorização, transporte e leitura

Data: 04/11/2026. Estado: concluído local/controlado ([revisão](07c3a-mcp-review.md), [plano de execução](../superpowers/plans/2026-11-04-prometeus-cadence-07c3a-mcp-execution.md)).

O 07C.3 foi dividido:
- **07C.3a (este):** autorização OAuth, endpoint MCP, ferramentas de leitura e a página `/settings/mcp`.
- **07C.3b:** ferramentas que mudam dados (preparar e confirmar), reaproveitando as propostas revisadas do assistente.

Nenhum cliente real (Claude ou ChatGPT) foi conectado; o fluxo foi exercido com um cliente local no loopback.

## O que o cliente consegue fazer

- **`/settings/mcp`:**
  - mantém a estrutura da referência: vídeo (ainda sem conteúdo), URL real do conector com "Copiar", login OAuth, onde adicionar no Claude e no ChatGPT, e a dica de remover e adicionar de novo;
  - "Conexões autorizadas" mostra o cliente, quem autorizou, as permissões, a data e o último uso;
  - "Revogar", com confirmação, corta o acesso na hora;
  - os pedidos prontos que só consultam têm "Copiar"; os da referência que mudam dados ficam marcados como "chega com os comandos revisados".
- **Tela "Permitir acesso ao seu workspace":**
  - mostra o endereço de retorno, o nome que o aplicativo informou (marcado como informado por ele), a conta, o workspace ativo e as permissões;
  - tem "Permitir acesso" e "Recusar";
  - sem login, leva ao login e volta.
- **No Claude ou no ChatGPT:**
  - o conector se registra sozinho e pede o login;
  - depois usa `contacts_search`, `jobs_list` e `metrics_read` com as permissões escolhidas.

## Regras executáveis

- **Especificação:** MCP 2025-11-25 (também 2025-06-18 e 2025-03-26).
  - **Transporte:** Streamable HTTP com respostas JSON; GET e DELETE dão 405; `Origin` desconhecido dá 403; versão inválida dá 400; lote é recusado.
  - **Metadados:** Protected Resource Metadata e Authorization Server Metadata; o 401 traz `WWW-Authenticate` com `resource_metadata`; o 403 traz `insufficient_scope`.
- **Registro (RFC 7591):**
  - só cliente público;
  - redirects https, ou http no loopback;
  - até 20 por hora por endereço e 2.000 por hora no total (106a);
  - clientes nunca autorizados somem depois de 1 dia (106a).
- **Autorização:**
  - **Pedido:** PKCE S256 obrigatório; o redirect precisa ser exatamente um dos registrados (desconhecido mostra o erro e nunca redireciona); `resource` igual à URL do MCP;
  - **Retorno:** `state` e `iss` voltam em toda resposta (106a);
  - **Pedidos abertos:** até 20 por cliente, apagados ao vencer (106a);
  - **Consentimento:** pela sessão do app (Origin e 2FA), só para o workspace ativo e uma vez por pedido.
- **Tokens:**
  - opacos e guardados como SHA-256;
  - o código vale 60 s, é de uso único e reusado revoga;
  - o access vale 15 min e é preso ao recurso;
  - o refresh vale 7 dias, é rotativo e reusado revoga tudo;
  - os vencidos são apagados a cada rotação (106a);
  - há revogação RFC 7009.
- **Cada chamada:**
  - age como o usuário, com o papel atual;
  - usuário removido dá 403 e a concessão é revogada, então voltar ao workspace não reativa a conexão antiga (106a);
  - 120 chamadas por minuto por concessão.
- **Conexões:** só aparece a concessão que chegou a gerar um token e ainda tem um vivo (106a). Owner e admin veem e revogam todas; os outros, só as suas.
- **Anti-enquadramento:** `/mcp/*` e `/login` saem com `X-Frame-Options: DENY` e `frame-ancestors 'none'` (106a).
- **Relatórios:** o principal por token (MCP, chaves de API) não passa pela conferência de sessão de navegador, porque o workspace é fixo pela concessão e a participação é reconferida na transação.

## Diferenças em relação ao plano de tarefas

- **Divisão:** o pacote foi dividido em 07C.3a e 07C.3b.
- **Migrações:** 106 e 106a (a 100 estava ocupada).
- **Ferramentas:** `contacts_search`, `jobs_list` e `metrics_read` (com sublinhado, pela regra de nomes de ferramenta).
- **Client ID Metadata Documents:** não foram implementados; o registro dinâmico cobre Claude e ChatGPT.

## Validação executada

- **Unitários:** 4/4 (escopo, redirect, PKCE e versões) e o `next` do login.
- **Integração focada:** 9/9, sendo 3 dos achados da revisão. Cobrem:
  - metadados e registro;
  - fluxo completo com dados só do workspace autorizado;
  - escopo parcial e `insufficient_scope`;
  - reuso de código e de refresh, verificador errado e código vencido;
  - redirect desconhecido e falta de PKCE;
  - audiência errada, usuário removido e revogação;
  - consentimento para outro workspace, recusa e pedido reusado;
  - HTTP (401, 405, Origin, versão, lote, método desconhecido);
  - limites de registro e de pedidos;
  - conexões vivas e purga.
- **Suítes completas:** 597/597 de integração e 420/420 unitários. Build e tipos com exit 0, e `git diff --check` limpo.

## QA no navegador

Conta descartável `[RE] QA MCP`, com um cliente local (`qa-mcp-client.mjs`) e um ouvinte no `127.0.0.1:8787` para receber o retorno. Nenhuma chamada externa.
- **Pedido e consentimento:**
  - o pedido levou à tela de consentimento ([captura](evidence/07c3a-mcp/local-mcp-consent.jpg));
  - corrigido no QA: a caixa ficava estreita e o e-mail transbordava;
  - "Permitir acesso" voltou com o código, o `state` e o `iss`.
- **Token e ferramentas:**
  - a troca deu o token (900 s, três escopos);
  - `initialize` respondeu 2025-11-25 e `tools/list` mostrou as três ferramentas;
  - `contacts_search` achou o lead da fixture, e `metrics_read` respondeu.
- **`/settings/mcp`:**
  - mostra a URL real ([captura](evidence/07c3a-mcp/local-mcp-settings.jpg)) e as conexões ([captura](evidence/07c3a-mcp/local-mcp-connections.jpg));
  - aparecia também a concessão de uma tentativa cujo código nunca foi trocado, o que virou correção (106a);
  - "Revogar" pede confirmação ([captura](evidence/07c3a-mcp/local-mcp-revoke.jpg)), e a chamada seguinte deu 401.
- **375 px:** sem overflow horizontal na página e na tela de consentimento.
- **Limpeza (L-042 removed):** resíduo 0, e as tabelas MCP ficaram vazias.

## Limites

- **Clientes reais:** a conexão com Claude e ChatGPT não foi homologada; não há integração "pronta" declarada até um cliente próprio conectar.
- **Endereço de origem:** o limite por endereço depende do `x-forwarded-for` do proxy de produção; sem ele, vale só o teto global.
- **Comandos:** as ferramentas que mudam dados chegam no 07C.3b.
- **Vídeo:** "Ver o vídeo" continua sem conteúdo.
- **Sem paridade completa:** esta entrega não declara paridade.
- **Entrega:** sem push, merge ou deploy.
