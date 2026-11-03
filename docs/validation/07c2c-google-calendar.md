# 07C.2c — Google Agenda do cliente

Data: 03/11/2026. Estado: concluído local/controlado após revisão independente ([revisão](07c2c-google-calendar-review.md)). [Plano do pacote](../superpowers/plans/2026-11-03-prometeus-cadence-07c2c-google-calendar.md).

É o último dos três pacotes do 07C.2. FunnelsFlow e MeetFlow continuam como barreira, sem contrato oficial. Este aceite não é de produção pública.

## Referência e fidelidade

A referência não tem um cartão de agenda em Apps. O grid observado (EV-204) tem FunnelsFlow, Sheets, Apollo e MeetFlow. A agenda aparece só no Agente SDR (EV-256), que no Prometeus está em preparação.

Por isso:
- **Grid de Apps:** ficou idêntico, conferido no navegador.
- **Página da conexão:** `/settings/apps/google-calendar` não é linkada pelo grid. O 07B.1 a liga a partir da configuração do agente.
- **Visual:** segue a página Google Sheets: painel desconectado, formulário e resumo.
- **Escolha técnica:** usar o Google Calendar é decisão do plano, não observação do backend da referência.

## Contrato entregue

- **OAuth:**
  - PKCE S256 e dois escopos: `calendar.freebusy` (disponibilidade) e `calendar.events.owned` (criar e apagar eventos nas agendas do próprio usuário).
  - Sem os dois escopos, nenhuma conexão é criada.
  - O fluxo é o mesmo do Sheets, que saiu de `sheets.ts` para `google.ts` sem mudar o comportamento: `state` de 10 minutos, de uso único e preso ao usuário, à sessão, ao workspace e ao provedor.
  - Tokens cifrados, sem retorno ao navegador.
- **Disponibilidade:** proprietário ou administrador define:
  - fuso;
  - dias da semana;
  - início e fim;
  - duração (15, 30, 45 ou 60 min);
  - antecedência mínima;
  - janela.
  - Salvar testa o acesso com uma consulta de disponibilidade.
- **Horários livres:** proprietário, administrador ou operador consulta.
  - As regras são calculadas no fuso, inclusive em dias de horário de verão: um horário pulado vai para o instante seguinte e um horário repetido usa o primeiro.
  - Saem os horários ocupados no Google e as reservas locais.
  - O `slotId` é cifrado com AAD do workspace e fica preso à conexão, à revisão da configuração, ao intervalo e ao fuso. Vence em 5 minutos.
- **Reserva** (serviço e HTTP; quem vai usá-la é o 07B.3):
  - **Linha local e trava:** uma linha local por reserva, com trava por conexão. Duas reservas do mesmo horário, ou de horários sobrepostos, dão 1 sucesso e 1 conflito.
  - **Antes de criar:** a disponibilidade é relida.
  - **Evento:** tem um id determinístico, sem convidados e com `sendUpdates=none`.
  - **Resposta perdida:** a reserva fica incerta. A repetição com o mesmo `requestId` assume a reserva, consulta o evento pelo id e confirma, sem criar um segundo evento.
  - **Repetição durante a primeira tentativa:** recebe "ainda está sendo criada".
- **Cancelamento:**
  - Pela reserva local, com revisão.
  - Uma reserva já cancelada responde sem chamar o Google.
  - Uma reserva incerta é resolvida pelo DELETE: 404 e 410 contam como inexistente.
  - Uma reserva em criação não pode ser cancelada.
  - As transições de estado só andam para a frente.
- **Falhas:**
  - um 401 tenta uma renovação antes;
  - acesso recusado ou agenda não encontrada deixam a conexão em atenção, e a reconexão limpa;
  - 429, 5xx e rede devolvem 503 com "tente de novo".
- **Desconectar:** apaga os tokens. As reservas ficam como histórico, e os eventos continuam na agenda do cliente.
- **Fora deste pacote:**
  - outra agenda além da principal;
  - convidar o lead;
  - remarcar;
  - reservas criadas pelo agente (07B.3);
  - worker de reconciliação.

## Validação executada

- **Unitários:**
  - 6/6 no arquivo do 07C.2: fuso com e sem horário de verão, horário pulado e repetido, horários por dia, duração, antecedência e janela, ocupados, esquema;
  - suíte completa 388/388.
- **Integração focada:** 8/8.
  - **Escopos e permissões:**
    - os dois escopos são exigidos;
    - escopo faltando: 422 e 0 conexões;
    - nenhum token em listagens;
    - operador não configura (403) e nenhuma chamada ao Google;
    - configuração inválida: 422; revisão antiga: 409.
  - **Horários:** o operador consulta, sem os ocupados; intervalo acima de 14 dias: 422.
  - **Reserva:**
    - corrida pelo mesmo horário: 1 evento e 1 conflito;
    - a repetição devolve a mesma reserva;
    - `requestId` reaproveitado: 409;
    - lead inexistente: 404.
  - **Resposta perdida e cancelamento:**
    - resposta perdida: a reserva fica incerta, segura o horário, e a repetição confirma sem segundo evento;
    - cancelar duas vezes faz 1 DELETE;
    - incerta sem evento cancela depois do 404;
    - revisão antiga: 409.
  - **`slotId`:** de outro workspace, adulterado, vencido, configuração mudada ou ocupado no Google entre leitura e reserva: recusado, sem evento.
  - **HTTP e conexão:**
    - contrato HTTP: autorizar, validação 422 e 503 sem cliente OAuth;
    - um 401 marca a conexão para reconectar.
  - **Revisão:**
    - repetição durante a primeira tentativa;
    - consulta atrasada do Google;
    - reconexão limpa "agenda não encontrada";
    - lead apagado não esconde a reserva guardada.
- **Regressão do Sheets** depois da refatoração: 14/14 nos arquivos do 07C.2a e do 07C.2b.
- **Suíte completa de integração:** 529/529. Build e tipos exit 0, `git diff --check` limpo.
- **RED:** sem as correções da revisão, os 3 testes da revisão falharam; com elas, passaram.

## QA no navegador

Conta descartável `[RE] QA Agenda`, em 1920×855:
- **Desconectado:** painel no padrão da página Google Sheets.
- **Sem cliente OAuth local:** "O Google Agenda ainda não está configurado neste ambiente.", sem chamada ao Google.
- **Disponibilidade** (fixture local, segredo vazio):
  - o envio mostrou "O acesso guardado não pôde ser lido. Reconecte a conta Google.";
  - não houve chamada ao Google, e o rascunho foi mantido.
- **Conectada:** resumo com fuso, dias, horário, duração, antecedência e janela. "Ver horários livres" levou ao estado de atenção, com "Reconectar conta Google".
- **Correções feitas no QA:**
  - alinhamento dos dias da semana;
  - aviso de atenção duplicado;
  - frase sobre os horários escondida quando a lista não aparece.
- **Grid de Apps:** igual ao anterior, sem cartão de agenda.
- **375 px:** sem overflow horizontal.
- **Capturas:** [disponibilidade](evidence/07c2c-google-calendar/local-calendar-setup.jpg) e [atenção](evidence/07c2c-google-calendar/local-calendar-attention.jpg).
- **Não exercido:** o consentimento real do Google e a criação de eventos numa agenda real. Não há cliente OAuth nem conta Google de teste autorizados; esses caminhos estão cobertos pelos testes, com o Google simulado.

## QA, runtime e custos

- **L-035 removed:** conta, workspace e pedido de workspace removidos por IDs exatos, com resíduo 0. Isso inclui conexões, tentativas OAuth e reservas.
- **Migrações:** 099/099a aplicadas localmente.
- **Runtime:** reiniciado para carregar o `sheets.ts` refatorado. Não há lane novo: a agenda não tem worker.
- **Custo externo:** zero, sem nenhuma chamada ao Google.
- **Entrega:** sem merge, push ou deploy.

## Limites

- **Operação:** exige `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` e `GOOGLE_CALENDAR_REDIRECT_URI`, com o retorno em `/api/integration-oauth/google-calendar/callback`.
- **Verificação do Google:** os escopos de agenda são sensíveis, então o app OAuth precisa dela antes do uso público.
- **Bloqueio sem confirmação:** uma reserva que não confirmou em 10 minutos libera o horário sem consultar o Google. A releitura da disponibilidade antes de criar ainda protege o horário.
- **Mesma conta em dois workspaces:** só a releitura da disponibilidade separa as reservas, então uma corrida entre eles pode reservar o mesmo horário duas vezes.
- **Cancelamento por operador:** um operador cancela qualquer reserva do workspace, não só as suas.
