# EV-284 — Webhooks de saída 07C.1a

[obs EV-284] Sessão s22, 02/11/2026. Referência L4 sem novas capturas nem escrita: texto da página e do diálogo (EV-260/262/263) e componente cliente retido `20ketoonyj8b5.js` (`/api/settings/webhooks`). O componente mostra:
- até 10 destinos com badges de eventos e listas, contagem de entregas e falhas seguidas;
- interruptor de ativo, testar, histórico, editar e excluir;
- "Gerar novo" segredo mostrado uma vez;
- eventos de lead e do agente;
- cabeçalho `X-Webhook-Signature` com HMAC SHA-256 do corpo.

A seção de chave OpenAI própria da mesma página ficou fora (IA central, decisão do usuário).

Local: identidade descartável L-031 (removed), sem leads, sem eventos e sem POST externo. Painel de 1152×303 em y=195 (referência 1152×301 em y=194). Sem overflow em 390/320.

Limites: o payload exato da referência não foi observado; a entrega real a um receptor externo não foi exercitada. Paridade 100% não aceita.

[Relatório](../../../validation/07c1a-webhooks.md) e [revisão](../../../validation/07c1a-webhooks-review.md).
