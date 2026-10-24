# Operação contínua local

O aplicativo mantém quatro serviços Node independentes: `dispatch`, `sync`, `jobs` e `scheduler`. O PostgreSQL continua no Docker. O supervisor e a tarefa do Windows não precisam do navegador nem do Codex abertos. A dependência atual do Codex CLI pertence ao adaptador `codex-local`, não aos serviços de e-mail/WhatsApp.

## Operar

Na pasta do projeto:

```powershell
npm run db:up
npm run db:migrate
npm run runtime:install
npm start
```

`runtime:install` registra uma tarefa do usuário Windows atual, sem elevação, executada ao fazer login e a cada minuto para verificar o supervisor. A tarefa garante o processo oculto e recupera sua ausência; não inicia outro quando ele já está ativo. `npm start` e `npm run dev` também garantem o supervisor. O aplicativo web continua tendo seu comando próprio; a tarefa registrada mantém os serviços de fundo, não a interface Next.

A ação agendada usa `wscript.exe` com `scripts/runtime-ensure.vbs`, iniciando a verificação Node com janela oculta. Não usa PowerShell como entrada da tarefa: um executável de console pode exibir uma janela brevemente antes de aplicar `-WindowStyle Hidden`. Windows Script Host precisa estar disponível nessa instalação. Depois de atualizar esse iniciador, execute `npm run runtime:install` uma vez para substituir a ação da tarefa existente, sem criar uma tarefa duplicada.

```powershell
npm run runtime:status
npm run runtime:stop
npm run runtime:start
```

A parada solicita conclusão do trabalho atual. Um envio com resultado incerto continua sujeito à reconciliação existente; reiniciar não autoriza repeti-lo. O supervisor reinicia uma lane que terminou inesperadamente. A perda do supervisor fecha o canal IPC das lanes, que param de aceitar trabalho. Dados de diagnóstico ficam em `.runtime/`, ignorada pelo Git, sem tokens ou conteúdo de mensagens.

Para remover a supervisão no próximo login, desabilite a tarefa `PrometeusCadence-*` correspondente a esta pasta no Agendador de Tarefas do Windows. Para pausar use `runtime:stop`; a pausa é persistida e respeitada pela tarefa. `runtime:start`, iniciar o app ou reinstalar a tarefa reativa os serviços. Não apague o volume PostgreSQL.

## Frequência e orçamento

O operador da instalação pode configurar estas variáveis em `.env.local` e reiniciar o runtime. Segredos continuam nesse arquivo e no armazenamento cifrado existente; não os envie em chats.

| Variável | Padrão | Intervalo válido |
| --- | ---: | --- |
| `RUNTIME_DISPATCH_MS` | 2000 | 1000–60000 ms |
| `RUNTIME_SYNC_MS` | 5000 | 1000–60000 ms |
| `RUNTIME_JOB_MS` | 2000 | 1000–60000 ms |
| `RUNTIME_SCHEDULER_MS` | 2000 | 1000–60000 ms |
| `RUNTIME_DISPATCH_MESSAGES` | 5 | 1–20 por tick |
| `RUNTIME_SYNC_BOXES` | 5 | 1–10 por tick |
| `RUNTIME_SYNC_MESSAGES` | 20 | 1–100 por caixa |

Os intervalos são contados depois de terminar o tick, com até 10% de jitter. Só há um tick simultâneo em cada lane. Falhas aumentam a espera progressivamente até 60 segundos. A lane de leitura é independente do despacho. O banco conserva intervalo mínimo de **60 segundos por caixa** depois de completar a sincronização; consultar trabalho a cada cinco segundos não consulta o Gmail a cada cinco segundos. Lotes incompletos mantêm o cursor e retomam sem importar toda a caixa.

O início do runtime habilita processamento de mensagens já confirmadas, sincronização e programação de automações ativas. Não ativa automações pausadas, não confirma propostas nem cria campanhas. Prospecção/IA continua obedecendo `PROSPECTING_ENABLED`, rotas, créditos, autorizações e limites registrados. Todas as lanes atendem workspaces elegíveis; o isolamento e os leases permanecem no PostgreSQL.

## Atualização das telas

- Conversas de e-mail e WhatsApp: aproximadamente cinco segundos.
- Caixas e conexões: dez segundos.
- Dashboard, relatórios, contatos, cadências, execuções e integrações: cinco a quinze segundos conforme a área.
- Abas ocultas/offline pausam as consultas visuais; serviços de fundo continuam. Retornar à aba retoma respeitando o intervalo mínimo e o backoff.
- Sem consultas sobrepostas dentro de cada loop. As respostas de uma seleção/workspace anterior são descartadas. Rascunhos e histórico paginado ficam preservados. Alterações concorrentes com editor aberto exigem revisão antes de salvar.
- Snapshot do workspace utiliza uma verificação de versão e permissões antes de ler os registros completos. Dashboard e relatórios consultam contagens reais de mensagens separadamente, sem carregar os corpos. Aceitação pelo provedor não é confirmação de entrega; abertura/clique permanecem indisponíveis.

Esta instalação funciona enquanto o computador e Docker estiverem disponíveis e o usuário tiver iniciado a sessão Windows. Sono, desligamento e falta de rede interrompem a operação local. Hospedagem futura precisa executar os mesmos serviços sob um gerenciador de processos no servidor. Gmail usa polling controlado; WhatsApp depende de webhooks válidos e de suas credenciais Meta/Twilio.
# OpenWA gerenciado

A quinta lane, `channels`, executa a cada `RUNTIME_CHANNELS_MS=5000` (configurável de 1 a 60 segundos). Cada rodada realiza até cinco operações de sessão e cinco trabalhos de recuperação; não transmite mensagens. Uma sessão pronta é conferida a cada 30 segundos. O gateway conserva a autenticação no volume Docker e controla sua reconexão.

A recuperação consulta a API privada com a chave limitada à sessão, em páginas de até 20 mensagens, e verifica até 20 recibos conhecidos a cada rodada elegível de 15 segundos. O cursor anda do mais recente ao mais antigo dentro de uma janela superior fixa. O checkpoint só avança depois da última página, com sobreposição de dois segundos; webhook e leitura REST compartilham deduplicação. Evidências REST recebem a origem `gateway-read`.

O limite é de 15 minutos de atraso e cinco páginas por janela. Lacunas, tempos desconhecidos ou cinco falhas consecutivas pausam a automação e exigem ação na conexão. Falhas transitórias têm espera persistida, limitada a cinco minutos. Resultado incerto mantém a reserva e nunca autoriza um novo envio pela ausência da mensagem no histórico, inclusive após 24 horas.

Depois de mudar o ambiente, reinicie explicitamente o supervisor e os containers afetados com a mesma configuração. `npm run runtime:status` deve mostrar `dispatch`, `sync`, `jobs`, `scheduler` e `channels` vivos. O instalador Windows continua usando VBS/wscript e processos ocultos. Shutdown drena operações; uma resposta posterior a logout, revisão nova ou lease vencida é descartada.

