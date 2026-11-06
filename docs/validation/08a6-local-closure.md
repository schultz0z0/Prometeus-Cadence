# 08A.6 — Ajustes visuais e provas locais

## Comparação visual

Foram usadas as capturas guardadas em 1920×855 e 390×844. As contas locais têm dados de QA e estado comercial controlado. A faixa móvel do teste disponível passou a ter texto centralizado e ação abaixo, preservando os sete dias. As capturas locais estão em `output/playwright/visual-audit/08a6-*.png`. [Linha de base das diferenças](08a3-remaining.md)

| Área | O que foi ajustado | Limite da comparação |
|---|---|---|
| Cadências | Faixa Hoje, busca e filtros, seleção de lista ou cards e ícones dos indicadores. A fila usa o próximo horário registrado e o fim do dia no fuso do workspace. | A referência mostra uma cadência populada. A comparação visual local concentrou-se nos controles e na faixa. |
| Nova cadência | Texto Sem conteúdo e estilo do nó Saída. | O editor de mensagem continua acessível pelo nó. |
| Nova automação e Gerador | Ícones coloridos no seletor de fontes compartilhado. CNPJ por termo permanece indisponível. | A situação de cada fonte acompanha as capacidades do Prometeus. |
| Importar Leads | Etapas e aviso azul de limite, com o saldo real e o máximo de 500 por lote. | A referência tinha franquia comercial diferente no estado capturado. |
| E-mail | Aviso sem recebimento configurado, aviso distinto para conta em atenção e estado vazio ilustrado. | O texto descreve os tipos de conexão disponíveis no Prometeus. |
| Membros | Assentos usados e capacidade do plano. O limite antes do teste segue a regra de convite do banco. | O proprietário mantém o controle de papel do convite. |
| Primeiros passos | Cartão informativo na coluna lateral no desktop e abaixo da lista no celular. A ação abre a Central de Ajuda. | O usuário escolheu manter a área informativa sem oferta de montagem. A referência tem 8 de 14 etapas feitas e agrupa o progresso com o título. A conta local está em 0 de 14, com o progresso num bloco separado. |

O aceite visual continua pendente. O registro mantém separados os estados sem captura, as divergências de produto e os recursos dependentes de integrações. [Seletores](08a5-selectors.md)

As capturas de Primeiros passos a partir do início da página estão em `output/playwright/visual-audit/08a6-first-steps/`.

## Provas transversais

- Relatórios usam mensagens terminais de QA para conferir total de e-mails aceitos, filtro por cadência e uma linha no detalhe. O funil continua conferindo os sete contatos do teste original.
- Papéis foram exercitados em quatro telas. O administrador tem as ações de conexão das caixas e de convite em Membros. O operador não pode realizá-las. A política de Privacidade é exclusiva do proprietário.
- A jornada de módulos acrescentou os popups da fila de hoje, de adicionar etapa e de abrir a sugestão de IA. O detalhe de Relatórios também foi exercitado. O formulário de template foi testado com 503, rascunho e foco preservados.
- A varredura de teclado mede até oito controles distintos do conteúdo inicial em 1440×900. Se a rota tiver menos controles, a prova exige todos. Diálogos e formulários condicionais permanecem com provas por jornada.

As jornadas de navegador usaram registros fictícios `[RE]`, contas `example.com`, cadência pausada e canal desconectado. O 503 e a caixa de e-mail em atenção foram respostas controladas no navegador. A projeção de fila e sua autorização foram verificadas no PostgreSQL efêmero. [Revisão](08a6-local-closure-review.md)

O usuário autorizou incorporar o ajuste de relógio de `6c0c618`, limitado aos dois arquivos de integração do LinkedIn. A execução anterior ao ajuste reproduziu as duas falhas de data fixa. As suítes usam o ambiente efêmero com transporte controlado.

## Medição final

- 24 de 24 jornadas e 576 de 576 visitas passaram após a última edição. O teclado percorreu 446 focos distintos nas 72 sondagens das telas iniciais. O isolamento foi conferido entre as duas contas. As jornadas, a varredura e a captura adicional terminaram com resíduo zero.
- O auditor aceitou 108 de 129 itens. Restam 17 bloqueados e quatro pendentes. Os quatro estados comerciais sem captura equivalente têm prova local e são classificados separadamente.
- Passaram 458 de 458 unitários e 664 de 664 integrações executadas. Os cinco cenários de homologação Stripe ficaram fora da execução. As duas integrações LinkedIn com data fixa passaram após o ajuste autorizado. O p95 medido de relatórios foi 107 ms.
- Build, checagem de tipos e `git diff --check` passaram. O verificador da base de conhecimento encontrou os mesmos quatro erros preexistentes em `clone/barriers.md`.

[Jornadas](evidence/08a-final-regression/journeys.json) · [Varredura](evidence/08a-final-regression/route-sweep.json)

## Portas do aceite integral

O relatório de cobertura mantém separadas as provas locais e as homologações. Permanecem decisões de produto e aceite visual, permissões para custo e envio real, dados e contrato do LinkedIn, credenciais e piloto do SDR, escolha de CRM e contas de teste para Google. MCP em clientes reais, webhooks públicos, SMTP e login Google dependem de uma URL ou infraestrutura pública. O plano do 08B depende do 08A, então a ordem desses pré-requisitos públicos precisa de decisão explícita. [Matriz de aceite](08-release-matrix.json)
