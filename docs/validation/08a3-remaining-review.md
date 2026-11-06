# Revisão final — 08A.3

05/11/2026. Revisão feita por um subagente independente, somente leitura, sobre a mudança antes do commit. Encontrou 2 Critical, 8 Important e alguns Minor. Sem as correções, o auditor teria contado aprovações que nada media.

| Achado | Correção | Regressão |
|---|---|---|
| Critical: em `reports-data`, o "7" casava com o botão "7 dias", então passava sempre, e os relatórios mostravam o estado vazio | O passo mede o cartão "Total Leads". Item dividido: "funil conta os contatos reais" e "relatórios com dados", pendente | Jornada |
| Critical: "apagar texto antigo: execução" só ligava a política | Item dividido: a jornada prova ligar; a exclusão cita o teste de integração | Registro |
| Important: a recuperação do relatório casava com uma aba presente em todos os estados | O aviso de erro aparece, some, e o estado vazio volta | Jornada |
| Important: itens prometiam "demais telas" e "demais formulários" com 8 telas e 1 formulário | Cada item diz o que rodou; o resto ficou pendente | Registro |
| Important: recusa do operador sem controle positivo; `403 POST` permitido de forma ampla | Quem tem o papel repete a mesma chamada e passa; a permissão ampla saiu | Jornada `admin` |
| Important: "pesquisa e enriquecimento" aprovado com a prova de um lead, pela rota antiga | Bloqueado | Registro |
| Important: "relatórios e notificações" citava um SMTP local que o relatório não menciona | Bloqueado: o aviso externo está desligado | Registro |
| Important: critério incoerente, "fica no 08B" aprovava identidade e bloqueava webhooks | Uma regra só: efeito externo não homologado bloqueia. Identidade ficou bloqueada | Registro |
| Important: busca sem resultado, sem conexão, escondia a caixa de WhatsApp e a própria busca | O estado vazio só aparece sem busca, sem filtro e sem erro | [Teste](../../tests/08a3-visual-fixes.test.ts) |
| Important: `journeys.json` não tinha as jornadas novas, porque `--only` não grava | Medição final completa depois de todas as edições | Auditor |
| Minor: operador via "Conectar" em tela que não administra | O botão só aparece para dono e administrador | Teste |
| Minor: o foco inicial do diálogo não era acompanhado | `last` começa no elemento ativo | Jornadas de foco |
| Minor: `visual-compare` deixava conta para trás se o cadastro falhasse | Tudo dentro do `try`; a limpeza acha a conta pelo e-mail; só banco local | Rodada manual |

## Aceito com limite

- **Prospecção local:** não confere o conteúdo da pré-visualização.
- **Em andamento:** é simulado; o nome do item diz isso.
- **Troca de estado vazio:** a caixa de WhatsApp mostra o layout por um instante antes.
- **Botão substituído:** o foco não volta se o botão for trocado por outro, em vez de reabilitado.

## O que a revisão não cobriu

Nada foi rodado em navegador pelo revisor. Os relatórios dos módulos bloqueados foram lidos por busca, não por inteiro; a migração 018 e a 084c não foram conferidas na busca de estados que o worker pega.
