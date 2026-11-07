# Revisão do 08A.7

A revisão independente foi somente leitura. Conferiu que a lista encerra o carregamento no 503, que o progresso usa os dados reais e que as provas exercitam papéis distintos.

A revisão observou que o carregamento automático podia satisfazer a asserção de recuperação. A jornada passou a exigir uma resposta 200 de leitura em até três segundos após clicar em Atualizar. A prova de gravação também confere zero caixas persistidas para o workspace fictício depois do 503.

A primeira rodada completa capturou uma recusa sobre chaves de API onde a prova esperava a recusa sobre webhooks. A rota consulta os dois recursos em paralelo e ambas as recusas são válidas para operador. A prova aceita as duas mensagens e exige que os dois controles de criação estejam bloqueados. Proprietário e administrador precisam ter os dois controles habilitados.

A prova do formulário cobre falha e preservação do rascunho. A gravação bem-sucedida de uma configuração e a autorização OAuth são cenários separados. [Relatório](08a7-local-regression.md)
