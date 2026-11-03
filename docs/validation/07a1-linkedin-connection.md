# 07A.1 — Conexão da conta LinkedIn pela Unipile

Data: 03/11/2026. Estado: concluído local/controlado, com a Unipile simulada nos testes ([revisão](07a1-linkedin-connection-review.md), [plano de execução](../superpowers/plans/2026-11-03-prometeus-cadence-07a1-linkedin-execution.md)).

Nada foi contratado, e nenhuma chamada real à Unipile ou ao LinkedIn foi feita. A habilitação de verdade depende de três coisas do usuário:
- o contrato e a chave da Unipile (`UNIPILE_DSN`, `UNIPILE_API_KEY` e um `LINKEDIN_PUBLIC_URL` alcançável pela internet);
- uma conta LinkedIn de teste própria;
- a leitura jurídica do termo.

## O que o cliente consegue fazer

Em `/linkedin/dashboard`, no passo 2 dos pré-requisitos (mesmo padrão da referência EV-239: o passo ativo tem um link laranja na legenda):
- **Conectar.** "Conectar o LinkedIn →" abre o termo de risco. Com o aceite, o cliente vai para o login hospedado da Unipile; o Prometeus não vê a senha.
- **Ver a conta.** Aparecem o nome, o estado (`conectada`, `conectando`, `precisa reconectar`, `sincronização parada`) e a última verificação. O indicador mostra a última verificação; não finge tempo real.
- **Ações:** "Verificar agora", "Reconectar" (quando a conta está restrita ou com erro) e "Desconectar", com confirmação. Só owner e admin veem as ações; operador vê "Peça a um administrador".
- **Volta do login:** um aviso diz que a conta foi conectada, que aguarda a confirmação, que a conexão foi cancelada ou que falhou. O aviso vem do estado do servidor, e o parâmetro sai da URL.
- **Passo 3:** com a conta pronta, diz que as campanhas de convite ainda não estão disponíveis. Nenhuma ação nova é oferecida.

## Contrato

- **Tabelas:** `app.linkedin_account`, `app.linkedin_connect_attempt`, `app.linkedin_account_event` e `app.linkedin_orphan` (migrações 101 e 101a).
  - Um workspace tem no máximo uma conta viva.
  - A conta do fornecedor e o membro LinkedIn nunca ficam em dois workspaces ao mesmo tempo.
  - Uma conta revogada continua como histórico.
- **Termo:** `LINKEDIN_TERMS`, versão `2026-11-03-rascunho`. Ficam registrados a versão, quem aceitou e quando. Uma versão nova exige um novo aceite (409 `LINKEDIN_TERMS_CHANGED`).
- **Tentativa:** uma por vez, com validade de 30 minutos.
  - Fica ligada ao usuário, à sessão e ao workspace.
  - Guarda só os hashes do `state` e do token do aviso.
  - Uma tentativa nova cancela as anteriores.
- **Vínculo em duas partes:**
  - O aviso da Unipile entra pelo papel `cadence_ingress`. O servidor confirma a conta em `GET /accounts/{id}` e grava a conta como verificada.
  - A conta só é vinculada quando o navegador de quem iniciou também volta, com a mesma sessão. A ordem entre o aviso e a volta não importa.
  - Na hora de vincular, o servidor confere de novo a trava do 07A.0, o papel do autor e a vaga.
- **Prontidão:** só no estado `ready`, com a versão de capacidade igual à do atestado em vigor. Um atestado novo tira a prontidão até a próxima verificação.
- **Verificação:**
  - Uma por vez, com lease de 60 s; o mesmo `requestId` não repete a chamada.
  - Uma revogação durante a chamada descarta o resultado (409 `LINKEDIN_REVOKED`), e uma reconexão também (409 `LINKEDIN_CHANGED`).
  - Uma falha mantém o estado, com backoff de 5 min a 6 h e respeito ao Retry-After.
  - Nada reconecta sozinho.
- **Desconectar:** vale na hora (a época avança e as tentativas são canceladas) e mantém o histórico. Depois, a sessão é removida na Unipile; se a remoção falhar, o worker tenta de novo.
- **Sessões órfãs:** quando um login de criação é recusado ou nunca volta, a sessão criada na Unipile entra numa fila e é removida. A remoção nunca atinge uma conta viva nem uma conta de outro workspace.
- **Worker:** a lane `linkedin` faz:
  - verificações vencidas, a cada 6 h, só com a trava ligada;
  - remoções pendentes;
  - remoção de sessões órfãs.
- **HTTP:**
  - `GET/POST /api/linkedin/accounts`, com as ações `prepare-connect` e `confirm-connect`;
  - `POST /api/linkedin/accounts/:id/{sync,reconnect,revoke}`;
  - `GET /api/linkedin/oauth/callback` (redireciona com 303);
  - `POST /api/linkedin/oauth/notify` (corpo de até 8 KB).
  - Todas as respostas são `no-store`.
- **Correção no 07A.0:** `linkedin_capability_state()` só respondia com um membro no contexto. Agora também responde aos papéis do worker e da entrada de avisos.

## Diferenças em relação ao plano de tarefas

- **Migração:** 101 em vez de 097, que já estava ocupada.
- **Rotas:** `accounts/...` em vez de `[resource]`, e uma rota própria para o aviso.
- **Retorno da verificação:** a verificação devolve `{state,lastSyncAt}`, porque a saúde da conta não tem paginação. O cursor paginado nasce no 07A.2/07A.3, junto do feed que o usa.
- **Credenciais:** não há OAuth nem PKCE do cliente no Prometeus. A sessão fica na Unipile, e a credencial da plataforma fica no ambiente.

## Validação executada

- **Unitários:** 6/6 no arquivo do pacote.
  - prontidão;
  - estados da Unipile;
  - backoff;
  - termo e aviso;
  - configuração;
  - cliente Unipile (chave, 404, 429, rede fora, link https).
- **Integração focada:** 11/11.
  - **Trava e papéis:** sem fornecedor, ou com um fornecedor que não é a Unipile, ou sem aceite, nenhum link é criado. Operador recebe 403.
  - **Login hospedado:** o link é só para LinkedIn, com os endereços de origem certos. Nenhum segredo vai para o navegador.
  - **Aviso sozinho não vincula:** o retorno de outra sessão dá 403. Com o retorno da sessão certa, a conta fica `ready`.
  - **Link encaminhado:** o retorno da vítima dá 403, o login expira sem conta e o worker remove a sessão da Unipile. Com o retorno antes do aviso, o vínculo acontece quando o aviso chega.
  - **Avisos recusados:** um aviso numa tentativa velha ou com a trava desligada apaga a sessão no fornecedor. O caso `TAKEN` nunca apaga.
  - **Repetição e falsificação:** o mesmo aviso repetido não muda nada. Outra conta com o mesmo token dá 409, um token desconhecido dá 404, e outro workspace com a mesma conta ou o mesmo membro dá 409.
  - **Tentativas encerradas:** tentativa nova, login cancelado, link vencido, autor removido e trava revogada não vinculam nada.
  - **Verificação:** o mesmo `requestId` faz uma única chamada. Verificações simultâneas fazem uma chamada, e a outra recebe 409. Fora do ar, o estado e a última verificação ficam, com backoff. Um 429 com Retry-After de 2 h espera 2 h. Revogar durante a chamada descarta o resultado.
  - **Reatestado e reconexão:** um atestado novo tira a prontidão, e a verificação devolve. A reconexão usa `reconnect_account`. Outra conta ou outro membro dá 409 e não apaga a conta viva.
  - **Desconectar:** revisão antiga dá 409. A remoção que falha fica pendente e o worker conclui. Outro workspace recebe 404, o histórico fica `['connected','revoked']`, e a mesma conta pode ser conectada de novo.
  - **Worker:** verifica só o que está vencido, sem cruzar workspaces, e lê a trava. Com a trava desligada, não chama o fornecedor.
  - **HTTP:** 401, 422, 409 de workspace, 403 e 404. Callback sem sessão redireciona com `failed`. Aviso grande dá 422, pelo cabeçalho ou pelo corpo. O papel do app recebe 42501 ao vincular, ao ler o id do fornecedor ou ao ler tentativas.
- **Suítes completas:** 548/548 de integração e 399/399 unitários. Build e tipos com exit 0, e `git diff --check` limpo.

## QA no navegador

Contas descartáveis `[RE] QA LinkedIn Conta`. Como a Unipile não está configurada, a habilitação da plataforma e a conta conectada foram fixtures locais.
- **1920×855, passo 2 ativo:** link "Conectar o LinkedIn →" abaixo do título, como na referência ([captura](evidence/07a1-linkedin-connection/local-linkedin-connect-step.jpg)).
- **Termo:** cinco condições e botão desligado até o aceite. Sem a chave, aparece "A conexão com o LinkedIn ainda não está configurada neste ambiente.", o aceite fica marcado e nenhuma tentativa é gravada ([captura](evidence/07a1-linkedin-connection/local-linkedin-terms-not-configured.jpg)).
- **Conectada:** aviso de retorno, passo 2 concluído, nome, estado e última verificação ([captura](evidence/07a1-linkedin-connection/local-linkedin-connected.jpg)).
- **Verificar sem chave:** a conta é mantida e o motivo aparece uma vez só ([captura](evidence/07a1-linkedin-connection/local-linkedin-check-failed.jpg)).
- **Restrita:** o passo 2 volta a ser o próximo, com "Reconectar" ([captura](evidence/07a1-linkedin-connection/local-linkedin-restricted.jpg)).
- **Desconectar:** pede confirmação ([captura](evidence/07a1-linkedin-connection/local-linkedin-disconnect-confirm.jpg)). A conta fica revogada, com histórico, e a remoção no fornecedor fica pendente para o worker.
- **Aviso forjado:** `?linkedin=connected` sem conta mostra "aguardando a confirmação", não "conectada", e a URL fica limpa.
- **375 px:** sem overflow horizontal. O modal rola por dentro.
- **Encontrado e corrigido no QA:**
  - o link estava colado ao título;
  - o modal herdava o estilo de cartão dos passos;
  - o erro aparecia duplicado;
  - o aviso sumia ao limpar a URL.
- **Limpeza:** as duas contas, os workspaces, as sessões, as fixtures e as linhas LinkedIn foram removidos por ids exatos (L-037 removed, resíduo 0, tabelas LinkedIn com 0 linhas).
- **Sem chamadas externas:** nenhuma chamada à Unipile nem ao LinkedIn.

## Limites

- **Contrato real da Unipile:** os nomes de campo e o comportamento do aviso (inclusive se a Unipile repete o aviso) vêm da documentação pública (SRC-009, SRC-010). Precisam ser confirmados com a conta de teste antes de ligar o atestado.
- **Termo:** é um rascunho e precisa de leitura jurídica.
- **Referência:** o estado conectado do CadenceFlow não foi observado, porque a conta de referência não tem LinkedIn conectado. O estado conectado segue o padrão visual dos passos observados.
- **Sem garantia de paridade:** busca, convites, aceite e mensagens ficam para o 07A.2 e o 07A.3. Esta entrega não declara paridade.
- **Entrega:** sem push, merge ou deploy.
