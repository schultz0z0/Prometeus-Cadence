# 07B.2 — Agente SDR: atendimento supervisionado

Data: 04/11/2026. Estado: concluído local/controlado, sem piloto real ([revisão](07b2-sdr-conversation-review.md), [plano de execução](../superpowers/plans/2026-11-04-prometeus-cadence-07b2-sdr-conversation-execution.md)).

## O que o cliente consegue fazer

- **Na inbox do WhatsApp** (sem chat paralelo), quando a conversa está num canal com agente:
  - ver se a conversa está "Com o agente" ou "Com você";
  - ver o rascunho, editar, revisar e aprovar ou rejeitar;
  - assumir a conversa e devolvê-la ao agente;
  - "Tentar de novo" quando a IA falhou;
  - ver o motivo quando o agente não responde: passagem, abstenção, sem franquia, limite do dia, fora do horário ou fora de serviço.
- **Resposta manual:** responder pela caixa assume a conversa e descarta o rascunho.
- **Em `/sdr`:** o painel "Aguardando seu ok" lista os rascunhos pendentes, com link para a conversa.
- **Notificações:** rascunho pronto e passagem avisam o responsável; se ele saiu do workspace, avisam proprietários e administradores.

## Regras executáveis

- **Um turno por mensagem:** só a mensagem recebida mais recente dispara turno, um por vez em cada conversa.
- **Nada sai sozinho:** todo envio passa pela aprovação e pelo `confirmReply`, com opt-out, janela e limites de canal (20/5 do OpenWA) no caminho já existente.
- **Depois da IA:** tudo é revalidado sob trava. Pessoa assumiu, opt-out, mensagem nova ou agente fora de serviço descartam a resposta, guardam o recibo e liberam a reserva.
- **Falha da IA:** fica `uncertain`, sem repetição automática; até 3 tentativas manuais.
- **Aprovação:** checagem, enfileiramento e consumo da unidade acontecem na mesma transação. Mensagem nova depois da revisão dá 409.
- **Cobrança:**
  - 1 unidade `sdr` reservada por turno e consumida na aprovação;
  - abstenção, rejeição, passagem e descarte liberam;
  - sem franquia, o turno fica bloqueado sem chamar a IA.
- **Memória:** últimas 20 mensagens, sem envios com falha nem texto apagado; a retenção também apaga o texto e os campos do rascunho.
- **IA:** só `reply`, `handoff` ou `abstain`; sem ferramentas nem ações. Contexto, conhecimento, histórico e mensagem entram como dados.
- **Execução:** lane própria `sdr` no supervisor.

## Validação executada

- **Unitários:** 2/2 (saída estrita e prompt).
- **Integração focada:** 8/8, cobrindo os casos do plano e os da revisão.
- **Regressão focada:** 07B.1 7/7.
- **Suítes completas:**
  - 430/430 unitários e 616/618 de integração; build e tipos com exit 0, e `git diff --check` limpo;
  - as duas falhas são `07A.3b assisted` e `07A.3c approving`, que dependem do horário e já falhavam antes do 07B.2;
  - a correção está no commit `6c0c618`, na branch `claude/jovial-ardinghelli-03da7a`, ainda sem merge aqui.

## QA no navegador

Conta descartável `[RE] QA Conversas SDR`, com fixtures locais: Pro piloto, conexão OpenWA `[RE]` marcada como pronta, agente ativo e um rascunho inserido direto no banco.
- **Inbox:** a conversa abriu pelo link `?conversation=`, com "Com o agente" e o rascunho com as respostas do script ([captura](evidence/07b2-sdr-conversation/local-sdr-inbox-draft.jpg)).
- **Revisar resposta:** mostrou a prévia e "Aprovar e enviar".
- **`/sdr`:** painel "Aguardando seu ok" com o rascunho e o link.
- **Assumir, devolver e rejeitar:** funcionaram pela tela.
- **375 px:** sem overflow.
- **Limpeza (L-045 removed):** resíduo 0 e nenhuma mensagem de saída criada.

**Não exercitado no navegador:**
- **"Aprovar e enviar":** não cliquei, porque o worker de disparo do runtime estava ativo na máquina e a mensagem entraria na fila de verdade. O caminho está coberto na integração.
- **Geração com IA real:** o rascunho do QA veio de fixture. Nenhuma IA foi chamada neste QA.
- **Lane `sdr`:** o runtime em execução é anterior a esta mudança e precisa ser reiniciado para ter a lane.

## Limites

- **Piloto:** não houve conversa real nem IA real neste pacote. A única tentativa com a IA local (07B.1) falhou.
- **E-mail:** o agente responde só no WhatsApp; caixas de e-mail saíram do editor.
- **Agenda, CRM e follow-up:** ficam para o 07B.3. A IA não consegue propor essas ações.
- **Resposta sem aprovação:** segue bloqueada até o piloto.
- **Contrato próprio:** as telas operacionais da referência nunca foram observadas; não há paridade declarada.
- **Venda:** nada é vendido nesta etapa.
- **Entrega:** sem push, merge ou deploy.
