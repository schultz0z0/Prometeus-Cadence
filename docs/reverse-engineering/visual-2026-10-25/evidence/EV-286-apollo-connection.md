# EV-286 — Conexão Apollo 07C.2a

[obs EV-286] Sessão s24, 03/11/2026. A página Apollo de Apps segue o layout retido da referência: painel "Chave de API" e "Prefere planilha?". Nada da referência foi escrito nem chamado.

Local: identidade descartável L-033 (removed). Pela interface, uma chave fictícia foi conferida no endpoint de saúde do Apollo e recusada. A mensagem apareceu, o campo foi limpo, e o banco ficou com 0 conexões e a referência sem a chave. A chave fictícia não é um segredo.

Limites: a conexão aceita com chave real não foi exercida (coberta por testes com o Apollo simulado). FunnelsFlow e MeetFlow seguem sem contrato oficial.

[Relatório](../../../validation/07c2a-connectors.md) e [revisão](../../../validation/07c2a-connectors-review.md).
