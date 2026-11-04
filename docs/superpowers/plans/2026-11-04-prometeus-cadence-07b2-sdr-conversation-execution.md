# 07B.2 — Agente SDR: atendimento supervisionado

04/11/2026. Executa o [07B.2](2026-10-27-prometeus-cadence-07b2-sdr-conversation.md). Referência: as telas operacionais nunca foram observadas, então o contrato é próprio e fica dentro da inbox existente, sem chat paralelo.

## Escopo

- **Turno:**
  - uma mensagem recebida gera no máximo um turno (`UNIQUE(workspace, conversa, inbound)`);
  - só a mensagem recebida mais recente da conversa dispara turno, e há um turno em execução por conversa.
  - **Claim** (lane própria `sdr`, para a espera da IA não atrasar os outros workers) só pega conversas com:
    - agente publicado válido (`sdr_agent_for_connection`);
    - dono "agente";
    - dentro do horário;
    - contato sem supressão.
- **Memória:** últimas 20 mensagens da conversa com texto ainda disponível. Texto apagado nunca entra.
- **Resultado da IA (schema estrito):** `reply`, `handoff` ou `abstain`, mais os campos do script. Campos fora do script são descartados.
- **Depois da IA** (revalidação sob trava):
  - humano assumiu, época mudou, nova mensagem chegou, opt-out ou agente fora de serviço: turno `superseded`, sem resposta, reserva liberada;
  - `reply`: `pending-approval`, com notificação de aprovação;
  - `handoff`: conversa passa para o humano, com notificação ao responsável;
  - `abstain`: motivo registrado, reserva liberada.
- **Falha da IA ou worker perdido:** `uncertain`, sem repetição automática; a pessoa pode "Tentar de novo" (mesma reserva) ou assumir.
- **Aprovação:**
  - editar, aprovar ou rejeitar na inbox do WhatsApp;
  - aprovar usa `prepareReply`/`confirmReply`, com os mesmos bloqueios de opt-out, janela e limites de canal (20/5 do OpenWA incluídos); nada contorna o outbox.
- **Intervenção:** assumir e retomar com época; responder manualmente pela inbox também assume a conversa.
- **Cobrança:** reserva de 1 unidade `sdr` por turno, consumida quando a resposta entra no outbox. Abstenção, rejeição, passagem e `superseded` liberam; sem franquia, turno `blocked` sem chamar a IA.
- **Limite do agente:** `maxRepliesPerDay` conta turnos pendentes e enviados em 24 h; ao chegar no teto, turno `blocked`.
- **`/sdr`:** painel "Aguardando seu ok" com link para a conversa. Textos atualizados: o agente ativo prepara rascunhos e espera aprovação.

## Desvios do plano original

- **`propose-action` (agenda, CRM, consentimento):** fica para o 07B.3, junto dos serviços que a executam. A saída da IA não aceita esse tipo, então ela não consegue propor nem executar.
- **Bounded-auto e FAQ auto:** continuam bloqueados na ativação; toda resposta passa por aprovação humana até o piloto.
- **Canal e-mail:** só WhatsApp neste pacote; o editor deixa de listar caixas de e-mail. Fica como pendência.
- **Resumo evidenciado da memória:** não implementado; 20 mensagens bastam neste ponto.
- **Consumo:** ao aceitar no outbox, não no aceite do provedor.

## Persistência (109)

`sdr_thread_state` (dono, época, revisão) e `sdr_turn`. Funções:
- **Worker:** `sdr_claim_turn` e `sdr_finish_turn`.
- **App:** `sdr_set_owner`, `sdr_retry_turn`, `sdr_reject_turn`, `sdr_claim_approval`, `sdr_release_approval`, `sdr_finish_approval`, `sdr_note_human_reply`.

## Testes (RED primeiro)

- **Unitários:** parser da saída da IA e prompt com dados marcados (o horário é testado na integração, porque mora no SQL).
- **Integração:**
  - inbound repetido gera 1 turno e 1 chamada de IA;
  - humano assume durante a IA: resposta descartada;
  - opt-out e histórico de outro workspace;
  - falha da IA vira `uncertain` sem repetição;
  - uma unidade consumida ao aprovar, abstenção não consome, sem franquia não chama a IA;
  - aprovação editada entra no outbox uma vez, e a confirmação repetida não duplica;
  - papel removido e outro workspace dão 403/404;
  - fora do horário não processa;
  - `propose-action` é recusado.
