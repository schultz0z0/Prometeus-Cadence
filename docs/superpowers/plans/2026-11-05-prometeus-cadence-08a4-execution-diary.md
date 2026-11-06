# 08A.4 — Diário de Execuções

> Execução nativa com TDD e revisão independente somente leitura.

**Objetivo.** Reproduzir em `/executions` o diário de mensagens das cadências observado no CadenceFlow. Preservar o histórico de jobs em `/executions?view=jobs` e os links diretos existentes.

**Base.** EV-038, capturas desktop e mobile de Execuções e aceite do recorte em 05/11/2026.

- [x] Escrever integração para o GET de Execuções e confirmar RED. Conferir isolamento e revogação, exclusão de mensagens avulsas, status, busca e paginação. Usar o papel real da aplicação e registros inertes.
- [x] Ligar a leitura de outbox, mensagens e tentativas pela transação RLS existente. Retornar apenas nomes, timestamps, canal, estado e motivos públicos. Contar mensagens por estado antes da paginação. O modo de rastreio inclui somente tentativas registradas. Se o motor não registrou uma mensagem para determinada etapa, o diário não inventa uma linha.
- [x] Exercitar no navegador o diário vazio e com registros, filtros, teclado, falha, recuperação e histórico de jobs. Confirmar RED antes de implementar a tela. Comparar capturas de 1920×855 e 390×844, com verificação de overflow a 320 px. Usar os componentes visuais existentes que atendam à referência.
- [x] Revisar em leitura independente. Cobrir resultados incertos, falha posterior ao aceite, escopo após trocar de workspace e discrepâncias entre contagem e paginação. Corrigir regressões com RED → GREEN.
- [x] Após a última edição, medir jornadas e varredura, registrar resíduo zero, rodar suítes, build, tipos, auditor e diff. Atualizar matriz, relatório, revisão, plano mestre, manifesto, roadmap e KB (EV-307, L-054, s45). Registrar três commits locais.

QA usa somente dados fictícios `[RE]`, e-mails `example.com`, publicações pausadas, canais desconectados e mensagens não despacháveis no banco compartilhado. Usar o banco efêmero para provar leituras de estados em andamento. Sem fornecedor externo e sem efeitos de envio.
