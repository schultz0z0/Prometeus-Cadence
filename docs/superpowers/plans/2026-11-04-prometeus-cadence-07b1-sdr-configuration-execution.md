# 07B.1 — Agente SDR: configuração e ativação

04/11/2026. Executa o [07B.1](2026-10-27-prometeus-cadence-07b1-sdr-configuration.md). O atendimento real (turnos, memória, intervenção humana) é o 07B.2; agenda, CRM, follow-up e piloto, o 07B.3.

## Referência e fidelidade

- **O que foi observado (EV-043, EV-256):** o CadenceFlow em `/sdr`, numa conta sem Pro, mostra só o gate do plano Pro, com os textos:
  - "Recurso do plano Pro";
  - "O Agente SDR vem no plano Pro";
  - 300 conversas por mês;
  - os quatro blocos "Responde / Qualifica / Agenda / Passa";
  - "Você monta o agente em minutos" (definição, script, canal e regras de passagem);
  - "nasce pedindo o seu ok antes de cada resposta".
- **Contrato próprio:** as telas operacionais nunca foram observadas, então a configuração é um contrato próprio, rotulado, que segue esses quatro blocos e o padrão visual do app.
- **Sem venda:** nada é vendido nem tem botão de upgrade, porque o atendimento ainda não opera e os gates de venda são do 06G, depois do 07B.3. A página diz isso.

## Escopo

- **Gate:**
  - **Configuração:** só em workspaces Pro com assinatura ativa ou piloto (`billing_account.plan='pro'`, estado `active` ou `pilot`, período vigente). O teste de 7 dias é Essential e não libera.
  - **Fora do Pro:** sem Pro, a página mostra o gate no padrão da referência, com o status honesto "em preparação" e sem CTA de compra.
- **Agentes:**
  - mais de um por workspace (a referência anuncia "agentes ilimitados");
  - cada um tem rascunho versionado (`revision`), estado `draft`, `active` ou `paused` e um snapshot imutável da configuração ativada (`sdr_agent_revision`).
- **Configuração** (zod estrito; campos de modelo ou chave são recusados), nos quatro blocos da referência:
  - **Definição:** nome e instruções (quem é, o que oferece, tom).
  - **Script de qualificação:** até 10 perguntas, cada uma com campo e obrigatoriedade.
  - **Canal:** conexões WhatsApp ou e-mail prontas do workspace. WhatsApp é o padrão, LinkedIn fica fora, e com OpenWA o teto é de 20 respostas por dia.
  - **Regras de passagem:** membro responsável e até 10 regras.
  - **Horário:** fuso IANA, dias e início/fim, ou 24 h.
  - **Limites:** `maxRepliesPerDay` de 1 a 200, padrão 20.
  - **Conhecimento:** ids da base aprovada.
  - **`approvalMode`:** padrão `all`.
  - **`followupEnabled`:** padrão `false`.
- **Conhecimento:**
  - itens de texto (`faq` ou `note`), versionados;
  - rascunho, aprovado ou arquivado, e editar volta para rascunho;
  - sem URL e sem busca externa;
  - na simulação, o texto entra no prompt como dado, nunca como instrução.
- **Simulação:**
  - uma mensagem de exemplo e a resposta do agente com o rascunho atual (rota de IA central, como no assistente);
  - devolve a resposta, a decisão (`reply`, `handoff` ou `abstain`) e os campos qualificados;
  - nunca envia nada; até 30 por workspace por dia.
- **Ativação** (preparar e confirmar):
  - **Revisão:** mostra o escopo, os canais, o horário, os limites e o modo de aprovação, com um token preso a: revisão do agente, hash da configuração, versão aprovada do contexto e estado dos canais.
  - **Bloqueios:**
    - sem Pro;
    - contexto da empresa não aprovado;
    - nenhum canal pronto;
    - canal já ligado a outro agente ativo;
    - responsável que não é membro;
    - conhecimento não aprovado;
    - `bounded-auto` (só depois do piloto supervisionado do 07B.2);
    - `followupEnabled` (07B.3);
    - OpenWA acima de 20 por dia.
  - **Mudança depois da revisão:** dá 409.
  - **Confirmar:** idempotente por `requestId`; cria o snapshot e os vínculos de canal.
- **Pausa:**
  - tira os vínculos e incrementa a revisão;
  - só uma nova revisão e confirmação reativam.
  - `app.sdr_agent_for_connection(connection)` (para o worker do 07B.2) só devolve um agente ativo com: vínculo, canal pronto, Pro vigente e versão de contexto ainda aprovada.
- **Permissões:**
  - rascunho, conhecimento e simulação: `context.draft`, o que inclui operator;
  - aprovar conhecimento: `context.approve`;
  - ativar e pausar: `workspace.settings`, que exclui operator;
  - no banco, todas as escritas passam por funções SECURITY DEFINER com a mesma checagem de papel; o `cadence_app` só tem SELECT.
- **UI:**
  - **`/sdr`:** gate ou lista de agentes, editor com os quatro blocos, base de conhecimento, simulação e cartão de ativação com a revisão.
  - **Rótulo:** o estado ativo diz que as respostas começam com o atendimento (07B.2, em preparação).

## Persistência (108)

- **Tabelas:** `sdr_agent`, `sdr_agent_revision`, `sdr_knowledge`, `sdr_channel_binding` (FK `channel_connection` no workspace; UNIQUE por conexão) e `sdr_simulation`.
- **RLS:** forçada por workspace.
- **Funções:**
  - `sdr_save_agent`, `sdr_save_knowledge`, `sdr_set_knowledge_state`, `sdr_members`;
  - `sdr_reserve_simulation`, `sdr_activate`, `sdr_pause`;
  - `sdr_agent_for_connection`.

## Testes (RED primeiro)

- **Unitários:** schema estrito, padrões, horário, bloqueios (`sdrActivationAllowed` e `sdrBlockers`) e teto OpenWA.
- **Integração:**
  - salvar e simular não enviam nem ativam;
  - operator não ativa; campo de modelo é 422;
  - alterar depois da revisão dá 409; canal de outro workspace é bloqueado; dupla confirmação é idempotente;
  - pausa tira o vínculo, e só nova revisão reativa;
  - canal desconectado ou contexto removido invalida;
  - sem Pro, bloqueia;
  - outro workspace não vê nada;
  - limite de simulação;
  - função SQL chamada direto respeita o papel.

## Fora

- Responder conversas reais (07B.2).
- Agenda, CRM e follow-up (07B.3).
- LinkedIn.
- Venda e upgrade (06G).

## Ajustes da revisão (108a)

- **Pro:** as escritas e a simulação exigem Pro; `sdr_pro(workspace)` saiu do app, que usa `sdr_entitled()`.
- **Ativação no banco:**
  - `sdr_activate(agent, revision, context, request)` grava o snapshot do rascunho armazenado e reconfere a política dura;
  - as conexões são travadas;
  - a idempotência exige a mesma revisão.
- **Snapshot e validade:**
  - o snapshot inclui id e revisão de cada item de conhecimento;
  - o agente só atende com a versão aprovada mais recente do contexto.
- **Conhecimento aprovado:** só proprietário ou administrador o edita ou arquiva.
