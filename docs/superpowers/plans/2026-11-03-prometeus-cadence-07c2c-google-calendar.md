# 07C.2c — Google Agenda do cliente

Data: 03/11/2026. Terceiro pacote do [plano 07C.2](2026-10-27-prometeus-cadence-07c2-customer-connectors.md), depois do [07C.2b](2026-11-03-prometeus-cadence-07c2b-google-sheets.md).

## Referência e fidelidade

A agenda não tem um cartão em Apps na referência. O grid observado (EV-204) tem FunnelsFlow, Sheets, Apollo e MeetFlow. A agenda aparece só no Agente SDR, como "Agenda e registra no CRM" (EV-256), que no Prometeus está em preparação. Quem vai usá-la é o 07B.3.

Por isso:
- **Grid de Apps:** fica como na referência.
- **Conexão:** a página `/settings/apps/google-calendar` não é linkada pelo grid. O 07B.1 a liga a partir da configuração do agente.
- **Visual:** segue o padrão da página Google Sheets (painel desconectado, configuração e resumo).
- **Oferta:** a interface não oferece reserva automática. Ela diz que a reserva de reuniões chega com o agente SDR.

Usar o Google Calendar é decisão técnica do plano, não observação do backend da referência.

## Contrato

- **Autorização:** OAuth Google com PKCE e dois escopos:
  - `calendar.freebusy`, para ver a disponibilidade;
  - `calendar.events.owned`, para criar e apagar eventos nas agendas do próprio usuário.
  - Reaproveita a tentativa OAuth do 07C.2b: o `state` vale 10 minutos, é de uso único e fica preso ao usuário, à sessão, ao workspace e ao provedor.
  - Os tokens ficam cifrados. O fluxo comum do Google sai de `sheets.ts` para `google.ts`, sem mudar o comportamento do Sheets.
- **Disponibilidade:** proprietário ou administrador configura:
  - fuso;
  - dias da semana;
  - início e fim do expediente;
  - duração (15, 30, 45 ou 60 min);
  - antecedência mínima em horas;
  - janela em dias.
  - Salvar testa o acesso com uma consulta de disponibilidade.
- **Horários livres:** `readCalendarSlots` gera os horários pelas regras do fuso e tira os que estão ocupados no Google e as reservas locais.
  - Cada horário recebe um `slotId` opaco, cifrado com AAD do workspace. Ele fica preso à conexão, à revisão da configuração, ao intervalo e ao fuso, e vence em 5 minutos.
  - O intervalo consultado é de no máximo 14 dias.
- **Reserva:** `reserveCalendarSlot`, que pede `slotId`, lead e `requestId`.
  - Uma linha local `prepared` com chave única por início de horário: duas reservas do mesmo horário dão 1 sucesso e 1 conflito.
  - Antes de criar, relê a disponibilidade.
  - O evento é criado com um id determinístico (`sendUpdates=none`, sem convidados). Se a resposta se perde, a reserva fica `uncertain`. A repetição com o mesmo `requestId` consulta o evento pelo id e confirma, sem criar um segundo evento.
- **Cancelamento:** `cancelCalendarReservation`, pela reserva local, com revisão.
  - Uma reserva já cancelada não chama o Google de novo.
  - Uma reserva incerta é consultada antes de ser dada como cancelada.
  - 404 e 410 contam como já removido.
- **Quem reserva:** proprietário, administrador ou operador. Quem conecta e configura: proprietário ou administrador.
- **Falhas:**
  - 401 tenta uma renovação antes;
  - acesso recusado deixa a conexão em atenção, com "Reconectar";
  - 429, 5xx e rede devolvem 503 com "tente de novo".
- **Desconectar:** apaga os tokens. As reservas locais ficam como histórico, e os eventos continuam na agenda do cliente.

## Fora do pacote

- Escolher outra agenda que não a principal.
- Convidar o lead e enviar o convite.
- Remarcar.
- Reservas criadas pelo agente: ficam para o 07B.3.
- Um worker de reconciliação: a reserva incerta é reconciliada na repetição ou no cancelamento.

## Tarefas

1. **RED:**
   - unitários de fuso e horários (`America/Sao_Paulo` e um fuso com horário de verão);
   - integração com um Google simulado: OAuth e escopo, configuração, horários, corrida pela mesma reserva, timeout com reconciliação sem segundo evento, cancelamento duplicado com 1 efeito remoto, permissões, `slotId` vencido, alterado ou de outro workspace.
2. **Migração 099:** kind `google-calendar`, tabela `calendar_reservation` com RLS forçada e funções SECURITY DEFINER.
3. **Backend:**
   - `google.ts` (fluxo comum) e `calendar.ts`;
   - rota de retorno OAuth;
   - ações HTTP `calendar-authorize`, `calendar-configure`, `calendar-slots` e `calendar-reserve`, e a ação de item `calendar-cancel`.
4. **UI:** `calendar-connection.tsx` em `/settings/apps/google-calendar`.
5. Revisão independente, correções RED→GREEN na 099a, QA no navegador com conta `[RE]`, suítes, docs e KB.
