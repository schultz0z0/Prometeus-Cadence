# EV-282 — Busca global e assistente 06F.1

[obs EV-282] Sessão s20, 02/11/2026. Referência L4 sem novas capturas: o painel do assistente e a busca global foram comparados com as capturas retidas `reference-desktop-overlay-assistant.png`, `reference-mobile-overlay-assistant.png` e `reference-desktop-overlay-global-search.png` (EV-267). Nenhuma pergunta foi enviada à referência e nenhuma busca foi digitada nela.

Observado nas capturas da referência:
- **Assistente.** Painel flutuante à direita com cabeçalho, "nova conversa" e fechar. Card "Pra hoje · 1" com "Falta conectar um canal", ação e "Perguntar". Boas-vindas "Como posso ajudar?" com sugestão em pílula. Composer e rodapé "Com base na Central de Ajuda e na sua conta", com Central de Ajuda, suporte por e-mail e vendas.
- **Busca.** Modal no topo com placeholder de lead/cadência/página, dica vazia e rodapé ↑↓/Enter/Esc.

O componente de chat da referência não está nos bundles retidos em `artifacts/client`.

Local: geometria medida a 1920×855/390/320 com identidade descartável e leads `[RE]` ([qa-geometry.json](../../../validation/evidence/06f1-assistant-search/qa-geometry.json)), três capturas na mesma pasta. Zero envios. A única chamada externa foi a IA central da plataforma, que respondeu limite de uso da assinatura; nenhuma resposta da IA foi observada.

Limites: respostas, modelo e backend do assistente da referência não observados; aparência das mensagens e textos de ajuda são próprios. Paridade 100% não aceita.

[Relatório](../../../validation/06f1-assistant-search.md).
