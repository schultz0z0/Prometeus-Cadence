# 07A.1 — Conexão LinkedIn pela Unipile: plano de execução

03/11/2026. Executa o [plano de tarefas](2026-10-27-prometeus-cadence-07a1-linkedin-connection.md) com a rota decidida no 07A.0: conector de conta, Unipile. A Unipile fica simulada nos testes; nenhuma chamada real é feita sem contrato e chave do usuário.

## Como a Unipile conecta (documentação pública, SRC-009)

1. O servidor pede um link hospedado: `POST /api/v1/hosted/accounts/link` com `X-API-KEY`, `type` (`create` ou `reconnect` + `reconnect_account`), `providers:["LINKEDIN"]`, `api_url`, `expiresOn`, `notify_url`, `name`, `success_redirect_url`, `failure_redirect_url`. Recebe `{object:"HostedAuthURL",url}`.
2. A pessoa faz o login do LinkedIn na página da Unipile (não em iframe).
3. A Unipile avisa o `notify_url` com `{status:"CREATION_SUCCESS"|"RECONNECTED",account_id,name}` e redireciona o navegador.
4. `GET /api/v1/accounts/{id}` traz `type:"LINKEDIN"`, `name`, `connection_params.im.{id,publicIdentifier}` e `sources[].status` (`OK`, `STOPPED`, `ERROR`, `CREDENTIALS`, `PERMISSIONS`, `CONNECTING`).
5. `DELETE /api/v1/accounts/{id}` encerra a sessão no fornecedor.

Não há token OAuth do cliente no Prometeus: a sessão fica na Unipile, e o Prometeus guarda só o `account_id`. A chave da plataforma fica no ambiente (`UNIPILE_DSN`, `UNIPILE_API_KEY`).

## Desenho

- **Termo de risco:** antes de gerar o link, owner/admin aceita um termo versionado (rascunho, pendente de leitura jurídica). Versão, autor e data ficam na conta e no evento.
- **Tentativa:** uma por vez no workspace, 30 minutos, ligada a usuário, sessão e workspace. Guarda só hashes de dois segredos: o `state` do retorno do navegador e o token do `notify_url`. Uma tentativa nova cancela as anteriores.
- **Aviso (`notify_url`):** entra pelo papel `cadence_ingress`, sem sessão. Só vale com o token da tentativa e `name` igual ao id dela. O servidor confirma a conta na Unipile antes de gravar, e regrava a trava do 07A.0 (`connect`), o papel do autor e a vaga na mesma transação. A repetição do mesmo aviso é idempotente; outro `account_id` com o mesmo token dá 409.
- **Retorno do navegador:** confere sessão e `state`; falha ou cancelamento encerra a tentativa. Não grava conta.
- **Conta:** uma viva por workspace; um `account_id` e um membro LinkedIn não servem dois workspaces. Estados `connecting|ready|restricted|revoked|error`. Pronta só com estado `ready`, não revogada e versão de capacidade igual à do atestado vigente (`adapter:revision`); um reatestado tira a prontidão até a próxima verificação.
- **Verificação (sync):** lê a conta na Unipile. Uma por vez (lease de 60 s); o mesmo `requestId` não repete I/O. Revogar durante o I/O descarta o resultado (época de credencial). Falha de rede preserva estado e última verificação, com backoff. Sem reconectar sozinho.
- **Desconectar:** revoga na hora (época +1, tentativas canceladas), mantém histórico e pede a remoção na Unipile; se falhar, o worker tenta de novo.
- **Worker:** lane `linkedin` verifica contas vencidas (a cada 6 h) e conclui remoções pendentes.
- **Cursor de sync:** o 07A.1 só sincroniza a saúde da conta, que não tem paginação. O cursor paginado (relações, convites, mensagens) nasce no 07A.2/07A.3 junto do feed que o usa.

## Arquivos

- `db/migrations/101-linkedin-connections.sql` (097 do plano original já estava usada).
- `src/domain/linkedin-connection.ts`, `src/server/linkedin/{unipile,connections}.ts`, `src/server/linkedin/http.ts`.
- Rotas: `src/app/api/linkedin/accounts/route.ts`, `src/app/api/linkedin/accounts/[id]/[action]/route.ts`, `src/app/api/linkedin/oauth/{callback,notify}/route.ts`.
- UI: `src/modules/settings/linkedin-sdr.tsx` e a página.
- Worker: `scripts/runtime-lane.ts`, `scripts/runtime-supervisor.ts`.
- Testes: `tests/07a1-linkedin-connection.test.ts`, `tests/integration/07a1-linkedin-connection.test.ts`.

## Ordem

1. RED unitário e de integração (Unipile simulada por `fetch` injetado).
2. Migração, domínio, serviço e HTTP até GREEN.
3. UI no passo 2 dos pré-requisitos: conectar (modal com termo), estado, última verificação, verificar, reconectar e desconectar.
4. Revisão independente, correções RED→GREEN numa 101a.
5. QA no navegador com conta `[RE]` e fixture local; suítes, build e tipos; docs e KB.

## Fora do escopo

Contratar a Unipile, chamar a Unipile real, ligar o atestado da plataforma e testar com conta LinkedIn real: dependem do usuário. Busca, convite, aceite e mensagens ficam no 07A.2/07A.3.
