# Operação contínua e atualização automática

Data: 23/10/2026. Estado: desenho aprovado pelo usuário, com implementação direta sem nova rodada de desenho/plano. Base: main `3366c2a`.

## Pedido e resultado esperado

O usuário quer sincronização permanente em todo o sistema, com frequência limitada para evitar sobrecarga. Nenhuma fila deve depender de um processo temporário iniciado pelo Codex ou de manter uma tela aberta. As telas devem refletir alterações automaticamente.

Hoje os executáveis de prospecção, agendador, despacho e sincronização existem, mas precisam ser iniciados separadamente. A sincronização Gmail já usa cursor, deduplicação, lease e intervalo de 60 segundos por caixa. As telas dependem principalmente de atualização explícita. Existe um worker temporário de homologação; ele deverá ser substituído sem duplicação de execução.

## Abordagens

1. **Recomendação para esta instalação: supervisor local e inicialização automática no Windows.** Mantém PostgreSQL no Docker e os executáveis Node no computador que possui a sessão Codex OAuth. Reinicia serviços que falharem e permite operação com Codex e navegador fechados. Exige Docker disponível e computador ligado; inicia após login do usuário Windows.
2. Todos os serviços em containers: adequada para uma futura instalação em servidor, mas a sessão Codex CLI local precisa de uma solução própria antes de migrar a prospecção/IA para o container.
3. Executar tarefas ao abrir telas: não atende à permanência pedida e não será usado como mecanismo de processamento.

A primeira abordagem foi aprovada junto com esta proposta. Não instalar nova ferramenta nem serviço pago.

## Serviços de fundo

- Separar leitura de caixas do despacho para uma leitura lenta não bloquear a fila. Uma execução simultânea por serviço inicialmente; conservar leases e isolamento por workspace no banco.
- Manter prospecção/IA e agendador supervisionados, respeitando as configurações de provedores e as ativações existentes. Não ativar automações pausadas, criar jobs, publicar cadências nem gastar créditos apenas por iniciar o supervisor.
- Despachar exclusivamente mensagens previamente confirmadas e elegíveis. Conservar limites globais, por canal, por remetente e intervalos existentes. Resultados incertos não recebem retry automático.
- Serviços atendem workspaces elegíveis, sem fixar o workspace usado na homologação. Credenciais e contextos permanecem isolados.
- Reinício com espera progressiva e jitter; desligamento ordenado; logs agregados sem segredos; diagnóstico de serviço ativo, última execução e erro.
- Configuração validada pelo operador da instalação para frequência e orçamento. A frequência de sincronização não substitui limites comerciais de envio.

## Frequências propostas

- Despacho: verificar trabalho a cada 2 segundos, em lotes pequenos; os limites do banco determinam quando cada mensagem pode sair.
- Prospecção e agendador: verificar trabalho a cada 2 segundos, uma execução por serviço; erros aumentam a espera até recuperação.
- Leitura de caixas: verificar caixas elegíveis a cada 5 segundos; conservar intervalo mínimo de 60 segundos por caixa, paginação e orçamento por execução.
- Inbox visível: atualizar a cada 5 segundos; configurações de conexão a cada 10 segundos; estado geral e andamento de jobs a cada 15 segundos.
- Uma requisição por atualização em andamento; pausar atualização visual em aba oculta/offline, atualizar ao voltar e aumentar intervalo após falhas. Não interromper o processamento do servidor quando a aba fica oculta.

Esses valores são propostas iniciais. Os limites válidos e a forma de configurá-los serão documentados; valores inválidos não poderão gerar loops sem espera.

## Preservação de estado visual

Atualizações automáticas preservam seleção de conversa, histórico paginado, rascunho de resposta, formulários não salvos e revisões pendentes. Respostas antigas de outra seleção/workspace são descartadas. Não buscar um snapshot completo a cada atualização de uma conversa; evitar republicar estado idêntico.

Cobrir inbox de e-mail e WhatsApp, estado de conexões, progresso de prospecção/IA/automações e dados compartilhados usados no dashboard, contatos e cadências. Configurações estáticas não exigem polling dedicado.

## Verificação antes de concluir

1. Testar configurações, ausência de sobreposição, espera progressiva, desligamento e recuperação de processo.
2. Testar atualização visual com aba oculta/offline, troca de workspace/conversa e preservação de rascunhos/paginação.
3. Validar reinício automático e operação independente da sessão Codex, sem gerar novas chamadas pagas ou mensagens de teste.
4. Confirmar que o worker temporário foi encerrado e que há apenas uma instância de cada serviço.
5. Executar testes relevantes, typecheck e build; documentar inicialização, parada, diagnóstico e limitações do computador local.

## Limites do compromisso

Atualização periódica controlada não equivale a push instantâneo. Gmail continua por polling; WhatsApp depende dos webhooks configurados. Desligar o computador interrompe a instalação local. Nenhuma configuração Meta/Twilio inexistente passa a estar validada por esta entrega. A ativação dos serviços será registrada como mudança explícita de operação em relação ao padrão desligado da homologação 05B.
