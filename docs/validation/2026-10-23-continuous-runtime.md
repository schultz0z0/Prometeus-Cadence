# Validação — operação contínua

Data: 23/10/2026. Base: `3366c2a`. Desenho aprovado para implementação direta.

## Evidências

- 221 testes unitários passaram, incluindo limite de frequência, exclusão de consultas sobrepostas, backoff, pausa visual offline/oculta, descarte após desmontagem e preservação de proteção contra escrita de formulário antigo.
- 33 testes de integração passaram: cliente HTTP/304 autorizado, sincronização, despacho, recebimento, métricas reais com isolamento de workspace e agendador PostgreSQL. Fixtures locais, sem mensagens externas.
- `npm run typecheck`, `npm run build` e `git diff --check` passaram.
- Runtime registrado no Agendador de Tarefas do usuário atual, com verificação por minuto e ao fazer login. Teste abrupto do supervisor `41504` em 05:09:07 UTC: tarefa iniciou novo supervisor `18964` em 05:09:46 UTC; as quatro lanes voltaram a apresentar sucesso. Resultado da tarefa: 0. Recuperação individual da lane de despacho também foi observada.
- Worker temporário da homologação encerrado. Cada nova lane roda separadamente, mantendo leitura de caixa independente do despacho. Status não contém tokens ou corpos.
- Browser plugin não disponível nesta sessão; Playwright já instalado foi usado com Chrome headless. Fluxo: dashboard autenticado → inserção confirmada de registro QA via API → contador atualizado sem reload → remoção do registro → inbox → rascunho → três ciclos automáticos. Rascunho preservado, zero erros de página. Nenhum envio foi confirmado e nenhuma chamada de IA foi feita.
- Validação visual desktop 1440×1000 e viewport 390×844, com capturas locais temporárias fora do repositório. A sessão de teste é mantida em memória; nenhum cookie foi registrado. Registro/lista temporários foram removidos ao final.

## Revisão e limites

Tentativa de revisão independente foi impedida pelo limite de uso do agente revisor. Foi realizada revisão direta dos diffs e dos contratos de isolamento, confirmação e renovação; não há parecer independente concluído para esta entrega.

Não foi reiniciado o computador para testar login Windows; foram exercitados o acionamento real da tarefa e a recuperação após falha. Não houve novo teste externo de Meta/Twilio, SMTP/IMAP, Apify ou LLM. A conta Gmail existente continuou sendo sincronizada. Limites comerciais de envio permanecem os configurados pelo usuário.

O tempo de atualização é polling, não garantia instantânea: cinco a quinze segundos nas telas e pelo menos sessenta segundos por caixa após sincronização completa. Computador/Docker/rede precisam estar disponíveis. A tarefa mantém serviços de fundo; o servidor web tem inicialização própria.

O provider ChatGPT OAuth direto é uma correção distinta, aprovada depois desta entrega; o adaptador `codex-local` não foi renomeado para simular OAuth direto.
