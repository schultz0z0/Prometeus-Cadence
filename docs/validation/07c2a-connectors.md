# 07C.2a — Cofre de credenciais e conexão Apollo do cliente

Data: 03/11/2026. Estado: concluído local/controlado após revisão independente ([revisão](07c2a-connectors-review.md)). [Plano do pacote](../superpowers/plans/2026-11-02-prometeus-cadence-07c2a-connectors.md). Primeiro dos três pacotes do 07C.2; o 07C.2b (Google Sheets) e o 07C.2c (agenda) seguem planejados. Não é aceite de produção pública.

## Contrato entregue

- **Página Apollo** (`/settings/apps/apollo`): painel "Chave de API" e bloco "Prefere planilha?", no layout da referência.
  - Campo com mostrar/ocultar e "Conectar"; Enter também envia.
  - Estado conectado mostra a data da conferência, "Trocar chave" e "Desconectar". Desconectar pede confirmação.
  - Somente proprietário ou administrador vê os controles; os demais veem só o aviso.
  - Erros são anunciados (`role="alert"`). Depois de uma falha, o aviso pede para colar a chave de novo, porque a referência já foi consumida.
  - O status na visão geral de Apps vem da conexão real.
- **Credencial:** a chave vira uma referência de uso único (10 minutos, presa ao usuário, workspace e app) e nunca volta ao cliente.
  - A conexão guarda a chave cifrada com AAD de workspace, conexão e revisão.
  - O app lê as colunas sem o segredo; só o worker decifra, dentro do lease.
- **Verificação:** `GET https://api.apollo.io/v1/auth/health`, com 10 s de limite e sem redirecionamento.
  - Chave recusada: 422 e nenhuma conexão. Apollo indisponível: 503.
- **Uso pela prospecção e pelas automações:** a conexão e a revisão revisadas entram no checkpoint e na prova da revisão.
  - Revogar ou trocar a chave depois da revisão faz a busca falhar com `CONNECTION_REVOKED`, sem usar outra chave.
  - Uma chave que não decifra falha com `CONNECTION_KEY_UNREADABLE`. Erros transitórios não viram "revogada".
- **Chave central:** só para workspaces listados em `APOLLO_CENTRAL_WORKSPACE_IDS`. `APOLLO_MAX_PAGES` explícito, inclusive 0, prevalece também sobre a chave do cliente.
- **Não ofertados:** FunnelsFlow e MeetFlow, sem contrato oficial. Google Sheets e agenda ficam para o 07C.2b e o 07C.2c.

## Validação executada

- **Unitários:** 2/2 no arquivo do 07C.2; 384/384 na suíte completa.
- **Integração focada:** 6/6.
  - referência de outro usuário, workspace ou app: 403; vencida ou usada: 409; 0 conexões, e o segredo da referência consumida é apagado;
  - chave recusada sem conexão; troca de chave com revisão nova;
  - busca com a chave própria; revogação depois da revisão impede a chamada;
  - contrato HTTP sem segredo nas respostas;
  - automação Apollo roda com a chave da conexão;
  - chave central só por lista; `APOLLO_MAX_PAGES=0` bloqueia; chave ilegível não é reportada como revogada.
- **Suíte completa de integração:** 511/511. Build e tipos exit 0, `git diff --check` limpo.
- **RED:**
  - os testes de revisão falharam antes das correções;
  - a regressão da automação voltou a falhar com o `dispatch.ts` anterior.

## QA no navegador

- Conta descartável `[RE] QA Apollo`, com trial local.
- Pela interface, uma chave fictícia foi conferida no endpoint de saúde do Apollo. O Apollo recusou, a mensagem apareceu e o campo foi limpo.
- No banco: 0 conexões, e a referência ficou sem a chave.
- [Captura](evidence/07c2a-connectors/local-apollo-refused-key.jpg).
- Uma conexão aceita com uma chave real não foi exercida: não há chave Apollo de teste autorizada. Esse caminho está coberto pelos testes, com o Apollo simulado.

## QA, runtime e custos

- **L-033 removed:** conta e workspace removidos por IDs exatos, sem resíduo; 0 conexões e 0 referências no banco local.
- **Migrações:** 097/097a aplicadas localmente.
- **Runtime:** reiniciado e ativo.
- **Custo externo:** uma única chamada GET de saúde com chave fictícia, sem créditos.
- **Entrega:** sem merge, push ou deploy.

## Limites

- O endpoint de saúde aceita qualquer chave válida. Uma chave sem permissão de busca pode ser aceita e falhar com 403 na primeira busca.
- Uma falha ao decifrar durante a conexão aparece como 503 genérico.
- A página faz duas leituras de conexões.
- O foco não volta ao botão depois de desconectar.
