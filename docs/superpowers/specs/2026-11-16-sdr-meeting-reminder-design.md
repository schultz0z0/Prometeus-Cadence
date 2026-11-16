# Lembrete de reunião do Agente SDR — desenho

Data: 16/11/2026. Pedido do operador depois da homologação real do objetivo "Marcar reuniões".

## Intenção

Com a reunião marcada pelo Agente SDR, o lead recebe pelo WhatsApp uma confirmação de presença perto do horário. O objetivo é reduzir faltas: quem confirma fica registrado, quem não pode remarca na hora com o próprio agente, e o time vê quem não respondeu.

## Decidido com o operador

- Dois lembretes: **na véspera** e **2h antes** da reunião.
- O lembrete é um **texto pronto do app**, como as mensagens de cadência da prospecção, sem IA. Exemplo:
  "Oi, Raphael! Passando para confirmar nossa reunião amanhã, terça, 17/11, às 09:00 (horário de Brasília), pelo Google Meet. Segue de pé? Se precisar, te ofereço outro horário."
  O de 2h antes **sempre sai, mesmo que o lead já tenha confirmado na véspera** (imprevistos acontecem), pede a confirmação de novo e **traz o link do Meet** no texto, avisando que ele também está no convite do e-mail. Exemplo:
  "Oi, Raphael! Nossa reunião é hoje às 15:30 (horário de Brasília). O link do Google Meet é https://meet.google.com/xxx-xxxx-xxx e também está no convite do seu e-mail. Segue de pé?"
  Se o lead **já confirmou** (presença `confirmada` no momento de montar o lembrete), o fim muda para não soar insistente: "...também está no convite do seu e-mail. Te espero lá!". Sem confirmação, termina com "Segue de pé?".
  O link é sempre o que está guardado na reserva (`calendar_reservation.meet_url`), o mesmo do convite; o lembrete nunca cria outro. Se a reunião não tiver link do Meet guardado, o texto sai sem a frase do link. Uma nova resposta "ok" volta a deixar a presença confirmada; "não vou conseguir" vira `remarcar`.
- A **resposta do lead** é atendida pela IA, como qualquer mensagem:
  - agradeceu, disse "ok", "confirmado": a IA responde curto e encerra; a presença fica confirmada;
  - quer remarcar, pelos motivos dele: a IA oferece horários livres reais e segue o fluxo de reunião já existente.
- Passa pela aprovação, como as outras mensagens do agente (o operador pode editar o texto antes de aprovar).
- Se o lead não responde, o agente não insiste; o painel mostra "sem confirmação".

## Escolhas minhas (corrigíveis)

- **Só no WhatsApp gerenciado (OpenWA).** No oficial, mensagem iniciada pelo agente exige template aprovado pela Meta, que ainda não existe no app.
- **Só reuniões criadas pelo agente** (`calendar_reservation` ligada a uma conversa do Agente SDR no estado `accepted`), com o objetivo "Marcar reuniões" e o agente ativo no momento do envio.
- **Horário da véspera:** 09:00 do dia anterior no fuso do agente. Se as 09:00 caírem fora do horário do agente, vai no primeiro horário permitido daquele dia; se o dia anterior não tiver horário de atendimento, não há lembrete da véspera.
- **Horário de 2h antes:** início − 2h. Se cair fora do horário do agente, não sai (o da véspera já cobriu).
- **Reunião marcada em cima da hora:** um lembrete só é criado se o horário dele vier pelo menos 1h depois da marcação. Marcada hoje para hoje à tarde: só o de 2h, se couber. Marcada a menos de 3h: nenhum.
- **Um lembrete só vira rascunho se a conversa estiver livre:** sem resposta do agente já esperando aprovação, sem turno em andamento e com o agente no comando (não "assumida" pela pessoa). Se não estiver livre, ele espera até 30 min antes do início da reunião e então é descartado.
- **Lembrete esperando aprovação vence:** se o horário da reunião passou, ou ela foi cancelada ou remarcada, o rascunho é descartado e não pode mais ser aprovado.
- **Limite diário:** o lembrete conta nas 20 mensagens por dia do número, pelo caminho de envio que já existe. Se o limite barrar, vale o comportamento atual de mensagens barradas.
- **Cobrança:** o lembrete não usa IA e não é cobrado como resposta do agente; as respostas da IA ao lead seguem a cobrança atual.
- **Base para mandar:** o lead escolheu o horário na própria conversa. Ao criar os lembretes, o app registra uma evidência de consentimento (finalidade `service`) apontando para a mensagem em que o lead escolheu o horário, como o retorno com autorização faz com a citação. Lead que pediu para parar ou está bloqueado não recebe lembrete; a checagem é feita na hora de virar rascunho.
- **Reuniões já marcadas antes da entrega** não ganham lembrete; só as criadas pelo agente depois dela.
- **A presença é gravada na aprovação**, não quando a IA termina: ela vai junto com o rascunho da IA (como a escolha de horário vai hoje) e só vale quando a pessoa aprova a resposta. Rascunho rejeitado não muda a presença.
- **Presença** registrada na reserva: `pendente` (lembrete enviado, sem resposta), `confirmada`, `remarcar` (lead pediu outro horário). Sem lembrete enviado, nada é mostrado.

## Remarcar

- Quando o lead pede outro horário depois do lembrete (ou a qualquer momento com reunião marcada), a IA marca isso numa saída nova (`reschedule`). O app volta a conversa para a etapa de oferta, sem o horário atual, e a IA oferece horários livres reais. A regra atual do prompt ("já há reunião marcada: não ofereça outros") passa a valer só quando o lead não pediu para remarcar.
- O lead escolhe; a aprovação da confirmação **move o mesmo evento** para o novo horário (Google Agenda `events.patch` com `sendUpdates=all`): o convite do lead é atualizado pelo Google e o **link do Meet continua o mesmo**. Nada de evento novo nem link novo. Antes de mover, o app confere que o novo horário está livre; se não estiver, nada muda e o agente oferece outros. Se o Google falhar, o evento continua no horário antigo.
- Os lembretes ainda não enviados param assim que a resposta em que o lead pede para remarcar é aprovada (presença `remarcar`). Quando o evento é movido, a presença volta a `pendente` e os lembretes são recriados para o novo horário.
- Se o lead pede para remarcar e some sem escolher, o evento antigo **continua na agenda** e o painel mostra "Lead pediu para remarcar": quem decide cancelar é a pessoa, pelo botão "Cancelar reunião" que já existe. O app nunca cancela sozinho sem um novo evento criado.
- Como a remarcação move o evento existente, a regra atual que recusa criar outra reunião enquanto há uma aceita (`sdr_booking_active`, migração 110) continua igual.

## Onde aparece

- **Conversa (painel do Agente SDR):** o lembrete chega como rascunho "Lembrete da reunião — nada sai sem o seu ok", com Aprovar/Editar/Rejeitar como as outras respostas. Abaixo de "Reunião marcada para…": "Presença confirmada", "Sem confirmação" ou "Lead pediu para remarcar".
- **Página do Agente SDR → Aguardando seu ok:** o lembrete aparece na lista como os outros rascunhos.
- **Configuração do agente (bloco Objetivo, quando "Marcar reuniões"):** uma caixa "Confirmar presença: lembrete na véspera e 2h antes", ligada por padrão.
- **Ficha do lead (seção do Agente SDR):** status "Presença confirmada para 17/11 09:00" ou "Remarcar".

## Não faz parte

- Template da Meta para o WhatsApp oficial.
- Lembrete por e-mail ou SMS (o convite do Google já lembra pelo próprio Google).
- Reuniões criadas fora do agente (direto no Google Agenda ou por "Reservar horário" manual).
- Marcar "faltou" depois da reunião.
- Texto do lembrete editável na configuração (o operador edita cada um na aprovação).

## Anti-objetivos

- Mandar lembrete de reunião cancelada, remarcada ou já passada.
- Mudar o link do Meet: o lembrete e a remarcação usam sempre o mesmo evento e o mesmo link do convite.
- Lembrete saindo sem aprovação, ou furando o limite diário do número.
- A IA inventando horário na remarcação (as checagens atuais de horário continuam valendo).

## O que já existe e será reaproveitado

- Retornos agendados do agente (`app.sdr_followup` e o laço de turnos devidos em `app.sdr_claim_turn`, migração 110): mesmo padrão de "linha com `next_at` que vira turno".
- Etapas da conversa (`sdr_thread_state`: qualifying/qualified/offer/done), oferta de horários (`pickOfferSlots`), checagens do rascunho e criação do evento na aprovação (`bookSdrProposal`), cancelamento (`cancel-booking`).
- Fila de envio, comprovantes e limites do OpenWA.

## Fica para quem constrói

- Se o lembrete é uma tabela nova (`sdr_meeting_reminder`, uma linha por lembrete) ou um novo `purpose` em `sdr_followup` (que hoje só permite um ativo por conversa).
- Como o turno do lembrete pula a IA no worker e chega direto a `pending-approval` com o texto pronto.
- Onde guardar a presença (coluna na reserva ou no estado da conversa) e como a IA a informa (saída nova, como `chosen`/`refused`).
