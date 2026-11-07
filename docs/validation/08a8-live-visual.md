# 08A.8 e 06A-V — Comparação com o CadenceFlow aberto

Em 07/11/2026, a aba autenticada do CadenceFlow foi usada em modo de leitura. Foram inspecionados Dashboard, Ajuda desta tela, Aprender, Execuções e telas de Configurações. A aba voltou ao Dashboard e o viewport temporário foi restaurado. O registro contém estrutura e medidas da UI, sem dados da conta de referência.

| Área | Referência observada | Resultado local e diferença |
|---|---|---|
| Aprender | Três atalhos em 1920×855, com cartões de 522×153 px. Seções de primeiros passos, trilha de entrada, trilhas especializadas, Central de Ajuda e passeios. | A rota `/aprender` usa a mesma ordem, três colunas no desktop e uma coluna no celular. Mostra o checklist e o progresso persistido do Prometeus. A referência tem catálogo em vídeo. O Prometeus oferece os próprios passeios guiados. A contagem de trilhas reflete o conteúdo disponível. |
| Ajuda desta tela | Botão na barra e painel à direita medindo 639 px no desktop. A ajuda contém busca e conteúdo da área atual. | Botão no mesmo grupo de ações e gaveta de 640 px à direita, em largura integral no celular. A busca recebe foco inicial e prioriza os guias da tela. Escape volta ao botão. |
| Execuções | Diário de mensagens, cartões de Sucesso, Erro, Pulado e Em andamento, período, status, rastreio e canais. | A estrutura de diário continua coberta pelo 08A.4. A rodada atual conferiu a superfície inicial na referência. [Relatório do diário](08a4-execution-diary.md) |
| Dashboard | Aprender no rodapé. Os cartões de onboarding agora promovem aula de boas-vindas e ajuda por tela. | A navegação do rodapé abre Aprender e o topo abre Ajuda. Os cartões de onboarding conservam o conteúdo próprio e o cartão informativo escolhido pelo usuário. |
| Configurações | Em 1920×855, foram observados os títulos e controles de Privacidade, Segurança, Contas de e-mail, Membros, Meu plano e Webhooks. Privacidade exibiu a política de retenção. Webhooks exibiu a seção de saída. | A comparação confirmou a organização principal dessas telas. A exportação privada prevista no desenho do Prometeus não apareceu na referência observada. O painel de chaves da API é uma diferença já registrada. Estados de assinatura e conexão seguem classificados pela evidência disponível. |

O usuário autorizou explicitamente os passeios e guias autorais nesta entrega em lugar do catálogo de vídeos, após a comparação. Essa diferença de conteúdo é aceita para a área Aprender.

A medição móvel em 390×844 na referência manteve a barra lateral de 260 px aberta na emulação e deixou a área principal comprimida. A estrutura em uma coluna foi observada. As larguras de cartões dessa sessão não são usadas como critério de igualdade. A conta local de QA também tem progresso diferente da conta da referência. Capturas locais em `output/playwright/visual-audit/08a8-*.png`.

O RED confirmou a ausência dos acionadores de Ajuda e Aprender no build anterior. A jornada local abriu a gaveta, usou Tab e Escape, conferiu o artigo contextual e buscou um termo sem resultado. Em Aprender, concluiu um passeio e confirmou o progresso após recarregar. Também exercitou a validação do período personalizado, o diálogo de autenticador e a revisão da sequência. O 503 simulado ao salvar cadência preservou o texto local e o registro anterior. A jornada de papéis verificou Google Agenda e Sheets no estado sem conexão. [Revisão](08a8-live-visual-review.md)

Uma interrupção da sessão deixou dez contas descartáveis e um catálogo efêmero de integração. As contas foram recuperadas pelo conjunto exato de e-mails fictícios, removidas por ID e verificadas com resíduo zero. O catálogo dessa execução foi identificado pelo intervalo de criação das fixtures e removido antes da retomada.

O 08A e o 06A-V continuam com diferenças e estados em aberto. A comparação atual comprova as áreas acima. A matriz preserva os casos condicionais de popups, papéis e rede, o aceite visual por área e os bloqueios de homologação. Os demais marcos seguem pendentes por orientação do usuário. [Matriz](08-release-matrix.json) · [Conexões externas](08a8-conexoes-externas.md)

Provas históricas específicas continuam utilizáveis no escopo em que foram executadas. A revisão de publicação e o editor de template foram exercitados no 06D.1. A investigação de empresa cobriu revisão, aplicação e recuperação de 503 no 06B.3. O teste de Agenda conferiu recusa a operador na API, separadamente da tela. Esses relatórios ajudam a localizar as lacunas sem repetir os casos já medidos. [Autoria](06d1-message-authoring.md) · [Investigação](06b3-company-research.md) · [Agenda](07c2c-google-calendar.md)

Para fechar as linhas transversais, ainda é preciso discriminar as variantes dos popups por estado, como edição e desconexão de caixas, revisão de automações e rotação de segredos. A prova de papéis na interface ainda precisa cobrir variantes com conexão e a revogação de conexões MCP. A prova de rede mantém como lacunas formulários de automações e limites de disparo. Estados que exigem integração real ficam na lista externa, e as variantes controladas devem ser identificadas no relatório de cada prova.

## Medição final

- Passaram 27 jornadas e 584 visitas em 73 rotas. A sondagem de teclado registrou 454 focos sem falha. O isolamento entre contas foi confirmado, com resíduo zero.
- O auditor aceitou 117 de 138 itens, com 17 bloqueados e quatro pendentes. Os quatro estados de referência desconhecida conservam prova local.
- A integração completa teve 663 aprovações, uma falha no limite de desempenho de relatórios e cinco cenários Stripe pulados. O p95 foi 267 ms na rodada com navegador em paralelo. A suíte de relatórios repetida isoladamente passou em 13 de 13, com p95 de 119 ms.
- Passaram 458 testes unitários, o build, a checagem de tipos e `git diff --check`. O verificador da base de conhecimento apontou os quatro erros preexistentes em `clone/barriers.md`.

[Jornadas](evidence/08a-final-regression/journeys.json) · [Varredura](evidence/08a-final-regression/route-sweep.json)
