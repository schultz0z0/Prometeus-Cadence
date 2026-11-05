# 07B.3 — Agente SDR: agenda, acompanhamento e piloto

04/11/2026. Executa o [07B.3](2026-10-27-prometeus-cadence-07b3-sdr-actions-pilot.md). As telas operacionais da referência nunca foram observadas: o contrato é próprio e fica dentro da inbox.

## Escopo

- **Sugestões da IA:** a saída ganha `action` (`calendar-options`, `followup-consent` ou nulo) e `quote`.
  - Ela não carrega ids nem executa nada; só acende uma sugestão no rascunho.
  - A citação do consentimento precisa estar literalmente na mensagem do lead, senão é descartada.
- **Agenda (Google Agenda real do 07C.2c):**
  - a pessoa pede os horários reais (`readCalendarSlots`) na própria conversa e escolhe um;
  - `prepare-booking` mostra contato e bloqueios; `confirm-booking` reserva com `reserveCalendarSlot`;
  - **proteção do horário:** o id do horário é selado e a disponibilidade é reconferida, com `SLOT_TAKEN` na disputa e estado `uncertain` sem segunda reserva, tudo do serviço existente;
  - uma reunião ativa por conversa; confirmar é idempotente por `requestId`;
  - cancelar delega a `cancelCalendarReservation`;
  - o rascunho só diz "agendado" depois da aceitação: "Inserir no rascunho" aparece só com a reserva `accepted`.
- **Follow-up:**
  - o agente precisa ter `followupEnabled`, que deixa de bloquear a ativação;
  - a pessoa confirma a autorização a partir da citação literal, com validade de até 30 dias;
  - no máximo 2 retornos separados por pelo menos 24 h, cada um como rascunho que passa pela mesma aprovação;
  - param com mensagem nova, opt-out, pessoa assumindo, retirada, vencimento ou agente fora de serviço;
  - fora da janela da Meta não há template neste fluxo: o follow-up termina com o motivo `WINDOW_CLOSED`.
  - A autorização grava `consent_evidence`, apagada quando o follow-up termina por retirada, opt-out ou assunção.
- **Cobrança:** rascunho de follow-up reserva 1 unidade como os outros. Agenda não cobra.

## Desvios do plano original

- **CRM:** sem `prepareSdrCrm`/`confirmSdrCrm`, porque não existe conector de CRM (o FunnelsFlow segue fechado por falta de API oficial). Fica como limite, não como adaptador falso.
- **Piloto:** `scripts/smoke-sdr.ts` e `pilot.ts` não são escritos, porque exigem número, contato, conta Google e autorização que dependem do usuário. O roteiro fica no relatório, e **o SDR não é declarado concluído sem piloto**.
- **Cancelamento:** sem token de revisão próprio; `expectedRevision` e a confirmação na tela cobrem a mudança.
- **Relatórios:** sem card novo em `/reports`.

## Persistência (110)

`sdr_business_action`, `sdr_followup`; em `sdr_turn`, `proposal` e `followup_attempt`, com a unicidade passando a incluir a tentativa. `sdr_begin_turn` concentra a abertura do turno.

## Testes (RED primeiro)

- **Unitários:** `sdrProposal` (citação literal, follow-up desligado, ação desconhecida).
- **Integração:**
  - dois contatos no mesmo horário: uma reserva, a outra recebe `SLOT_TAKEN`;
  - timeout depois do remoto fica `uncertain`, e a repetição não duplica;
  - id de horário inventado é recusado;
  - sem contato vinculado ou com opt-out, bloqueia;
  - segunda reunião ativa é recusada;
  - sem consentimento, 0 rascunhos de follow-up;
  - citação inexistente é recusada;
  - 2 retornos com 24 h e nada além;
  - mensagem nova, pessoa assumindo, opt-out, retirada e vencimento param;
  - janela fechada na Meta encerra;
  - outro workspace dá 404.
