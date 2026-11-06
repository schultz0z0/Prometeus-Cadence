# Revisão do Diário de Execuções

Em 05/11/2026, uma revisão independente e somente leitura conferiu as mudanças a partir de `fc09329`, incluindo o contrato HTTP, as consultas com RLS, a interface e as fixtures. O revisor não executou o navegador nem fez operações no banco.

| Achado | Correção e prova |
|---|---|
| E-mail aceito que recebe DSN correlacionado continuava em **Sucesso**. | O diário consulta a devolução registrada e usa o horário dela. A integração de relatórios reproduziu o DSN e mostrou o contador errado antes da correção. Depois passou com um erro e zero sucessos. |
| Alguns motivos de limite não correspondiam aos códigos do motor. | Os códigos de adiamento de e-mail e OpenWA têm texto próprio. A mensagem que continua na fila permanece **Em andamento**. A integração mostrou a mensagem genérica antes da correção e o motivo do limite depois. |
| A cobertura inicial não exercitava rastreio, incerteza, período e página excedente. | A integração agora compara as linhas e os contadores com e sem rastreio, confere que o diagnóstico interno fica fora da resposta, exercita o período com fuso do workspace e verifica a última página. |
| A jornada inicial fechava o seletor por teclado, mas não escolhia um valor. Também não chegava à segunda página. | A jornada seleciona Erro com setas e Enter, muda o tamanho da página e verifica os dois registros da segunda página. |

O revisor não encontrou vazamento entre workspaces na leitura. A fixture usa publicação pausada, inscrição parada, conexão desconectada, remetente indisponível e estados terminais no banco compartilhado. A leitura de um estado adiado foi exercitada no banco efêmero.

O QA interrompido durante o cadastro mostrou que o coletor de limpeza só conhecia contas com workspace já criado. Uma conta foi recuperada por endereço fictício e removida pelo id. Os scripts passaram a registrar os endereços exatos antes do cadastro, resolver os ids no fechamento e falhar se houver resíduo.

O navegador também expôs uma divergência entre a massa do banco e o contrato do shell. A leitura do snapshot reproduziu a falha em integração antes de completar os dados da fixture. O teste passou depois de incluir os campos exigidos para a cadência e o lead.
