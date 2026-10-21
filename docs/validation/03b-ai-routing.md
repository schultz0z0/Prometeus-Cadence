# Marco 03B — roteamento de IA

Implementação nativa na branch `codex/ai-routing`, sobre `7511ca4`. Spec e plano aprovados pelo usuário em 20/10/2026.

## Comportamento entregue

Em `/settings/ai`, owner/admin selecionam Codex CLI, OpenAI ou Gemini, escolhem Automático / Somente LLM convencional / Híbrido obrigatório e salvam a política por workspace. Operadores têm leitura. Chaves e modelo ficam no servidor; a interface não recebe credenciais.

Sem JEV configurado ou habilitado, o modo Automático permite que a LLM convencional qualifique e gere texto. Somente LLM convencional faz o mesmo independentemente do JEV. Com JEV habilitado/configurado, Automático e Híbrido obrigatório exigem uma convencional selecionada e um teste bem-sucedido dessa configuração nas últimas 24 horas. Falhas não trocam provedor automaticamente. JEV nunca roda sozinho.

Revisões congelam a rota e a política. Mudanças antes do próximo despacho exigem nova revisão, preservando resultados/consumo já recebidos. Qualificação é uma proposta com fontes; nenhum resultado altera o lead sem Aplicar. O probe de conexão é sintético e não pode ser aplicado.

## Evidência executada

- 92 testes unitários e 52 de integração PostgreSQL; typecheck e build webpack. Contagens finais e revisão constam no relatório de encerramento.
- Migrações 012 e 013 nos bancos local e `_test`, reaplicadas sem alterar dados/volumes. Checksums históricos preservados.
- Smoke anônimo: 50 rotas protegidas/APIs; login/401 conforme esperado. Smoke de provedor padrão retorna SKIPPED sem rede.
- Navegador desktop 1440: owner salva/recarrega política; Automático sem JEV mostra Codex como decisor/gerador; Híbrido obrigatório bloqueia sem JEV; diagnóstico confirma autenticação ChatGPT sem inferência; fechar modal não confirma; confirmar cria job acompanhado na interface, com resultado/uso e sem Aplicar.
- RBAC, workspace estrangeiro, resposta tardia e isolamento foram exercitados nos testes HTTP/cliente/PG. A sessão de automação do navegador deixou de responder durante a captura mobile 390; captura visual mobile e inspeção browser como operador/workspace B não foram concluídas neste aceite. Não confundir os testes de contrato com inspeção visual.

## Aceite real Codex

CLI existente `codex-cli 0.163.0-alpha.10.2`, modelo `gpt-6.1-sol`, autenticação ChatGPT já presente na máquina. Não houve leitura/cópia de OAuth, instalação de CLI, nem chave de API alternativa. Allowlist exclusiva ao workspace `QA · Marco 03 · fixtures` (`21e3c8e0-1bfc-4e12-83a3-a69fd4e32c70`); orçamento global/workspace de 3 codexCalls e zero nos demais provedores.

1. Probe `44c5f4fe-efcc-4f73-ae6e-ec454ed64995`: completed, 1 codexCalls, check success em 21/10/2026 01:32:09 UTC.
2. Lote `69846188-a654-4088-b698-365dac797c9e`: completed, 2 codexCalls, qualificação + resumo de um lead com evidência inteiramente sintética. Rota normal de prepare/confirm, reserva, worker, journal e persistência; somente o coletor foi substituído no harness privado de aceite. Não é coleta real da Web nem aferição de acurácia.

Total: **3 inferências reais**. Zero JEV/Apify/Apollo/OpenAI/Gemini e zero envio de mensagens. O lote sugeriu qualified com motivo/fontes e confidence null; lead permaneceu pending. [Resultados sanitizados](03b-live-results.json). Custo monetário desconhecido, não tratado como zero.

O primeiro despacho do probe foi rejeitado pelo CLI por `Unknown feature flag: node_repl`, antes da inferência. A rejeição foi reproduzida pelo comando local `features list`, sem chamada de modelo; teste de regressão RED→GREEN removeu a flag obsoleta, preservando ferramentas desabilitadas. Reconciliação explícita `confirmNotStarted` permitiu retomar o mesmo job sem aumentar o orçamento. Não houve retry automático de uma resposta incerta.

## Operação local

Configurar `.env.local` conforme `.env.example`. Para Codex: runtime local, URL loopback, `CODEX_LOCAL_ENABLED=true`, caminho absoluto do binário, modelo explícito e `CODEX_TEST_WORKSPACE_IDS`. Usar a sessão ChatGPT existente do CLI; o produto não oferece login OAuth hospedado nem extrai tokens. OpenAI/Gemini exigem chaves/modelos próprios e orçamento específico. JEV usa OpenRouter com `typesafe/jev-1.13`.

Depois de alterar ambiente: reiniciar servidor/worker. Em Provedores de IA, salvar política, verificar CLI (sem inferência) e abrir Testar LLM convencional para revisar/confirmar uma chamada. Processar fila QA com:

```powershell
rtk npm run worker -- --workspace 21e3c8e0-1bfc-4e12-83a3-a69fd4e32c70
```

O limite de três chamadas deste aceite está consumido. Novos testes exigem orçamento deliberado ou nova janela diária. O processo do worker fica separado do servidor; não é iniciado automaticamente pelo botão. O teste bem-sucedido expira após 24h ou mudança de credenciais/modelo/contrato.

O smoke explícito exige fila QA vazia e flags de workspace, fonte, limite e orçamento; APIs pagas exigem `--confirm-provider-cost`. O workspace deste aceite possui um job antigo do marco03 aguardando reconciliação, preservado; por isso o probe foi confirmado pela UI e processado com worker restrito ao workspace, não pelo smoke live. Nenhum job antigo foi apagado.

## Limitações

OpenAI/Gemini e a matriz híbrida foram testados por contratos/integração, sem credenciais reais. Este aceite demonstra transporte, contratos, uso e propostas com Codex; não mede qualidade empírica em massa. Cadências, mensagens e scheduler reais continuam nos próximos marcos.
