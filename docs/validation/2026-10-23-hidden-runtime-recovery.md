# Correção das janelas rápidas de terminal

O usuário relatou abertura e fechamento de terminal a cada poucos minutos, inclusive após fechar Docker Desktop. A inspeção da máquina confirmou a tarefa `PrometeusCadence-381A04C33C19` com repetição `PT1M`, executando `powershell.exe -WindowStyle Hidden -File scripts/runtime-ensure.ps1`. A tarefa foi criada pelo runtime contínuo e funciona independentemente do Docker. O log operacional do Agendador estava indisponível, portanto não foi possível correlacionar historicamente cada janela observada com um disparo específico.

Um processo de console pode criar sua janela antes de aplicar a opção de ocultação. A ação da tarefa foi substituída por Windows Script Host gráfico (`System32/wscript.exe //B //NoLogo`), que inicia diretamente o check Node com `Run(...,0,True)`. O script PowerShell intermediário foi removido. A tarefa mantém o mesmo nome, gatilhos, usuário e recuperação automática. Os serviços existentes não foram encerrados nem duplicados.

Validação:

- Teste de regressão escrito antes da implementação: falhou com o iniciador ausente e passou após a correção. Executa WScript real com caminho de workspace contendo espaços, verifica diretório de trabalho, argumento `ensure` e propagação de exit code 7.
- `node --experimental-strip-types --test tests/runtime-launcher.test.ts tests/runtime.test.ts`: 3 aprovados.
- `npm run typecheck`: aprovado.
- Ação instalada conferida como `C:\Windows\System32\wscript.exe`.
- Três execuções reais forçadas pelo Agendador: resultado 0, tarefa retorna a Ready. Enumeração de janelas visíveis a cada 15 ms, classes ConsoleWindowClass e CASCADIA_HOSTING_WINDOW_CLASS: nenhuma nova janela de terminal durante os disparos.
- A tentativa de observar processos por Win32_ProcessStartTrace não estava disponível (`0x80041032`); a verificação usou a ação registrada, o resultado do Agendador e enumeração de janelas, sem alegar evidência desse trace.

O usuário reabriu Docker Desktop durante a investigação. Os quatro serviços existentes recuperaram execuções com sucesso e sem falhas após a abertura do banco, preservando o supervisor e os mesmos PIDs dos workers. A observação de uma execução periódica automática da tarefa confirmou resultado 0 e nenhuma nova janela visível de terminal; os quatro serviços executaram com sucesso durante essa mesma observação. Não foram criados novos testes de envio ou geração.

Revisão independente do iniciador e do instalador: nenhuma regressão importante encontrada. O revisor também executou o teste real WScript e confirmou sua aprovação.

A suíte completa em paralelo teve um timeout no teste já existente de falha de banco (`messaging-operations`, timeout 15 s), sem relação direta com os arquivos alterados. A repetição isolada dos três testes dessa suíte passou em menos de um segundo. A execução completa sequencial (`node --experimental-strip-types --test --test-concurrency=1 tests/*.test.ts`) passou: **228 testes, nenhuma falha**, em 11,8 s. Nenhum timeout ou comportamento de produção foi alterado para obter esse resultado.
