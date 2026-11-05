# 07B.3 — Agente SDR: agenda, acompanhamento e piloto

Data: 04/11/2026. Estado: **parcial, sem aceite do SDR**. Agenda e follow-up estão entregues local/controlado; CRM não existe e o piloto não foi executado ([revisão](07b3-sdr-actions-review.md), [plano de execução](../superpowers/plans/2026-11-04-prometeus-cadence-07b3-sdr-actions-execution.md)).

## O que falta para concluir o SDR

- **Piloto real, que depende de você:**
  - número OpenWA e contato de teste próprios;
  - uma conta Google própria conectada à agenda;
  - IA central confirmada;
  - autorização para enviar.
- **CRM:** não há conector. O FunnelsFlow não publica API oficial, e nenhum outro CRM foi aprovado. Não existe adaptador falso e nada é oferecido.

### Roteiro do piloto (não executado)

1. Reiniciar o runtime, para subir a lane `sdr`.
2. Aprovar o contexto e ativar um agente no número de teste.
3. Mandar uma mensagem do contato de teste e conferir o rascunho gerado pela IA real.
4. Aprovar e confirmar o recebimento no aparelho.
5. Testar a passagem para o time e o assumir.
6. Pedir uma reunião, escolher um horário real e conferir o evento na agenda.
7. Pedir um retorno, registrar a autorização e conferir o rascunho depois de 24 h.
8. Conferir o consumo de 1 unidade por resposta aprovada.
9. Apagar os eventos e os dados de teste.

## O que o cliente consegue fazer

- **Na conversa do WhatsApp:**
  - **Reunião:**
    - "Ver horários da agenda" traz os horários reais do Google Agenda conectado;
    - escolher e "Confirmar reunião" cria o evento, sem convite ao contato;
    - cancelar pede confirmação;
    - "Inserir no rascunho" só aparece com a reunião aceita, e o texto traz o fuso da agenda.
  - **Sugestões do agente:** o rascunho avisa quando o contato quer marcar uma reunião ou pediu para ser procurado depois. A sugestão não executa nada.
  - **Follow-up:**
    - proprietário ou administrador registra a autorização a partir do trecho identificado, por 7, 14 ou 30 dias;
    - saem até 2 retornos, cada um como rascunho que espera aprovação;
    - qualquer membro pode retirar a autorização.
- **Agente:** o follow-up deixa de bloquear a ativação; responder sem aprovação continua bloqueado até o piloto.

## Regras executáveis

- **A IA não age:** ela só devolve `none`, `calendar-options` ou `followup-consent`, sem ids. A citação precisa estar literalmente na mensagem do contato.
- **Reserva:**
  - feita pelo serviço de agenda existente, com horário selado e disponibilidade reconferida;
  - um horário disputado dá `SLOT_TAKEN`, e o seguinte sai da oferta;
  - sem resposta do Google fica `uncertain`, e "Verificar de novo" não cria segundo evento;
  - uma reunião futura por conversa;
  - contato com opt-out ou sem vínculo não marca.
- **Follow-up:**
  - no máximo 2 retornos, com pelo menos 24 h contadas do que realmente saiu;
  - param com mensagem nova, opt-out, pessoa assumindo, retirada, rejeição de um retorno, vencimento ou agente fora;
  - encerrar descarta o rascunho aberto e libera a unidade;
  - só no WhatsApp gerenciado: na Meta o retorno exige template aprovado, e o registro é recusado.
- **Cobrança:** rascunho de retorno usa 1 unidade como os outros; a agenda não cobra.
- **Retenção:** apagar a mensagem também apaga proposta, citação e evidência.

## Validação executada

- **Unitários:** 2/2 novos (sugestão e saída da IA).
- **Integração focada:** 9/9, cobrindo agenda, disputa de horário, resposta perdida, bloqueios, follow-up, paradas e os casos da revisão. Regressão: 07B.2, 07B.1 e 07C.2c verdes com o Google simulado em memória.
- **Suítes completas:**
  - 432/432 unitários e 625/627 de integração; build e tipos com exit 0, e `git diff --check` limpo;
  - as duas falhas são `07A.3b assisted` e `07A.3c approving`, que dependem do horário e já falhavam antes do 07B.2;
  - a correção está no commit `6c0c618`, na branch `claude/jovial-ardinghelli-03da7a`, ainda sem merge aqui.

## QA no navegador

Conta descartável `[RE] QA Agenda SDR`, com Pro piloto, conexão OpenWA `[RE]` marcada como pronta e rascunho inserido por fixture.
- **Autorização:** o aviso apareceu com o trecho; registrar mostrou "Retorno autorizado até…", e retirar voltou ao estado anterior.
- **Sem Google conectado:** "Ver horários" passou a orientar a conexão. Corrigido no QA: dizia só "Conexão não encontrada".
- **Reunião marcada (fixture):** mostrou a data e "Cancelar reunião"; "Inserir no rascunho" escreveu a confirmação no texto ([captura](evidence/07b3-sdr-actions/local-sdr-inbox-meeting.jpg)).
- **375 px:** sem overflow.
- **Limpeza (L-046 removed):** resíduo 0 e nenhuma mensagem de saída.

**Não exercitado no navegador:**
- as telas pós-revisão (confirmação de cancelar, aviso de operador e recusa da Meta), feitas depois deste QA;
- reservar de verdade no Google;
- "Aprovar e enviar".

Esses caminhos estão só na integração com o Google simulado.

## Limites

- **IA real e piloto:** nunca exercitados de ponta a ponta.
- **E-mail:** o agente responde só no WhatsApp.
- **Retornos:** só no WhatsApp gerenciado.
- **`/reports`:** sem card do SDR.
- **Sem paridade nem venda:** esta entrega não declara paridade e nada é vendido.
- **Entrega:** sem push, merge ou deploy.
