# 07C.2a — Cofre de credenciais e conexão Apollo do cliente

Data: 02/11/2026. Primeiro pacote do [plano 07C.2](2026-10-27-prometeus-cadence-07c2-customer-connectors.md). O 07C.2 foi dividido:
- **07C.2a:** cofre de credenciais e Apollo com a chave do cliente;
- **07C.2b:** Google Sheets com OAuth;
- **07C.2c:** agenda.

FunnelsFlow e MeetFlow continuam indisponíveis: não há contrato oficial, então ficam registrados como barreira, sem oferta contratável.

## Contrato

- **Referência de credencial:** a chave colada vira uma referência opaca de uso único, presa ao usuário, ao workspace e ao app, que vence em 10 minutos. A chave não volta mais ao cliente.
  - Referência de outro usuário, workspace ou app: 403. Vencida ou já usada: 409. Nos dois casos, 0 conexões.
- **Conectar:** consome a referência, confere a chave no endpoint de saúde do Apollo e grava a conexão cifrada (AES-GCM com AAD de workspace, conexão e revisão).
  - Chave recusada (401/403 ou `is_logged_in` falso): 422 e nenhuma conexão. Apollo indisponível: 503.
  - Papel e associação são conferidos de novo depois da chamada externa. Trocar a chave sobe a revisão; conflito de revisão: 409.
- **Uso:** buscas e automações Apollo gravam no checkpoint a conexão e a revisão revisadas. O worker decifra a chave dentro do lease, logo antes da chamada.
  - Conexão revogada ou trocada depois da revisão: a busca falha com `CONNECTION_REVOKED` e não usa outra chave.
- **Chave central:** só para workspaces listados em `APOLLO_CENTRAL_WORKSPACE_IDS` (ou `*`), nunca por padrão. `APOLLO_MAX_PAGES` explícito, inclusive 0, sempre prevalece.
- **Interface:** a página Apollo em Apps tem o painel "Chave de API", no layout da referência. Mostra o estado conectado, com "Trocar chave" e "Desconectar" (com confirmação). Somente proprietário ou administrador gerencia.

## Persistência

- **Migração 097:**
  - `connector_credential_ref` e `integration_connection`, com uma conexão viva por app;
  - SELECT por coluna, sem o segredo;
  - funções `SECURITY DEFINER` para guardar, consumir, salvar, revogar e ler o segredo no worker.
- **Migração 097a:** limpa referências vencidas ou consumidas, exige papel no `connector_secret` e concede `connector_actor`.

## Testes

- **Unitário:** capacidades por conexão e esquema de entrada.
- **Integração:**
  - referências de outro usuário, workspace ou app, vencidas ou já usadas;
  - chave recusada e troca de chave;
  - busca com a chave própria e revogação depois da revisão;
  - contrato HTTP;
  - automação com a chave da conexão;
  - chave central opcional, kill switch e chave ilegível.
