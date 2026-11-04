# Revisão final — 07B.2

04/11/2026. A revisão foi feita por um subagente independente, somente leitura, sobre a mudança antes do commit. Não encontrou Critical. Encontrou dois High, nove Medium e onze Low. As regressões dos achados de servidor falhavam antes da correção. Nenhum achado permite que uma resposta saia sem `confirmReply`, outbox e os bloqueios de envio.

| Achado | Correção | Regressão |
|---|---|---|
| High H1: conversas fora do horário ou fora de serviço de um workspace ocupavam a janela de 50 e travavam os outros | Todos os bloqueios rodam antes do `LIMIT` | 51 conversas fora do horário em A, e B é atendida |
| High H2: turno `approving` podia ficar preso para sempre e parar o agente na conversa | Estado removido: aprovar, enfileirar e consumir acontecem na mesma transação | Aprovação repetida não duplica; recusa não muda nada |
| Medium M1: "Tentar de novo" e turnos na fila ignoravam opt-out e os outros bloqueios | `sdr_turn_eligible` no retry, na fila e no fim do turno | Retry com opt-out dá 409; turno na fila é descartado sem chamar a IA |
| Medium M2: falha de confirmação com resultado incerto podia enviar duas vezes | A transação única elimina a liberação manual | Coberto pelo mesmo teste do H2 |
| Medium M3: a aprovação não revalidava mensagem nova nem dono | `sdr_check_approval` sob trava, antes do enfileiramento | Mensagem nova depois da revisão dá 409 e nada entra na fila |
| Medium M3: pausa deixava rascunhos aprováveis | `sdr_pause` descarta os abertos e libera as unidades | Pausa: `superseded` e nada reservado |
| Medium M4: turnos abertos seguravam franquia sem prazo | Varredura de turnos com mais de 7 dias ou com opt-out | Coberto pela leitura do código |
| Medium M5: um candidato ruim abortava o claim de todos | Workspaces sem membro saem da lista | Coberto pela leitura do código |
| Medium M6: notificação sumia se o responsável tivesse saído | Proprietários e administradores são avisados | Responsável removido: notificação entregue |
| Medium M7: a inbox dizia "Com o agente" com o agente fora de serviço | `inService` na resposta, com aviso e link para revisar | Canal em atenção: `inService` falso |
| Medium M8: resposta manual assumia a conversa fora da transação | Hook na própria confirmação, ignorado em repetição | Resposta manual assume; repetição não inverte de novo |
| Medium M9: retenção não alcançava o rascunho | Gatilho apaga texto e campos quando a mensagem é apagada | Mensagem apagada: rascunho sem texto |
| Low L1: rascunho para mensagem já respondida à mão | Mensagem de saída posterior impede o turno | Nenhuma chamada à IA |
| Low L2: bloqueios não eram relidos sob a trava | Releitura depois da trava | Coberto pela leitura do código |
| Low L4: retentativas ilimitadas | Até 3 | A quarta dá 409 |
| Low L5: histórico incluía envios com falha e texto sem limite | Filtro por estado e corte por mensagem | Texto apagado fica fora do prompt |
| Low L6: prompt contraditório sobre a definição do agente | Definição dá identidade e tom, sem mudar as regras | Teste do prompt |
| Low L7: erro depois do claim abortava o ciclo | `try` cobre rota e parse, e o turno fica `uncertain` | Coberto pela leitura do código |
| Low L8: a lane `sdr` não fechava o pool ao desligar | Incluída na lista | Coberto pela leitura do código |
| Low L9: textos errados | Corrigidos ("nenhuma resposta sai", e-mail, "quem respondeu às cadências") | Conferido no navegador |
| Low L10: `GET /api/sdr/<qualquer>/:id` | Só `conversations` | Coberto pela leitura do código |
| Low L11: lacunas de teste | WORKER_LOST, texto apagado, aprovação concorrente com mensagem nova | Teste da revisão |

## Aceitos sem mudança

- **L3:** o teto diário do agente é aproximado sob concorrência. O limite do canal continua sendo imposto no disparo.
- **L4 (parte):** o uso da IA é perdido quando a chamada falha.
- **L10 (parte):** o painel mostra as 50 pendências mais antigas, sem paginação.
- **L6 (parte):** uma mensagem pode induzir a passagem para o humano. O impacto é só tirar o agente daquela conversa.
