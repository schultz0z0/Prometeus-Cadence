# EV-285 — API pública 07C.1b

[obs EV-285] Sessão s23, 02/11/2026. A referência não mostra chaves de API nem endpoints públicos. A página "Webhooks e API" dela (EV-262/263) tem webhooks e uma chave OpenAI própria, que ficou fora por decisão do usuário. A seção "API de leitura" é desenho próprio, no padrão visual da página; nada da referência foi escrito nem chamado.

Local: identidade descartável L-032 (removed) e dois leads `[RE]`. Pela interface: criar a chave, chamar `/api/v1/leads` (200, e 401 sem Bearer mesmo com cookie), gerar nova (antiga 401, nova 200) e revogar (401). O token não foi capturado.

Limites: sem documentação pública (OpenAPI); a emulação de 320 px não foi aplicada pelo painel. Paridade não se aplica (superfície própria).

[Relatório](../../../validation/07c1b-public-api.md) e [revisão](../../../validation/07c1b-public-api-review.md).
