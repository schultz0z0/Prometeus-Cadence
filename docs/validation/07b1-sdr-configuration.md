# 07B.1 — Agente SDR: configuração e ativação

Data: 04/11/2026. Estado: concluído local/controlado ([revisão](07b1-sdr-configuration-review.md), [plano de execução](../superpowers/plans/2026-11-04-prometeus-cadence-07b1-sdr-configuration-execution.md)).

O atendimento das conversas é o 07B.2. Até lá, um agente ativo não responde ninguém, e a tela diz isso.

## Referência e contrato

- **Referência:** o CadenceFlow só mostra, em `/sdr` sem Pro, o gate do plano Pro (EV-043, EV-256). As telas operacionais nunca foram observadas.
- **Contrato próprio:** a configuração é um contrato próprio. Segue os quatro blocos que a referência anuncia (definição do agente, script de qualificação, conexão do canal e regras de passagem) e "nasce pedindo o seu ok antes de cada resposta". O visual é o dos painéis de Configurações do app.
- **Sem venda:** nada é vendido nem tem botão de compra. O gate diz "Previsto para o plano Pro · em preparação".

## O que o cliente consegue fazer

- **Sem Pro** (inclusive no teste de 7 dias, que é Essential): `/sdr` mostra o gate.
- **Com Pro ativo ou piloto:**
  - **Agentes:** criar vários agentes, em rascunho, ativos ou pausados.
  - **Editor:**
    - definição (nome e instruções);
    - script com até 10 perguntas;
    - canais prontos do workspace (WhatsApp; com o gerenciado, até 20 respostas por dia);
    - responsável e regras de passagem;
    - horário com fuso, dias e início/fim, ou 24 h;
    - respostas por dia;
    - modo de aprovação;
    - follow-up;
    - itens da base.
  - **Base de conhecimento:**
    - perguntas frequentes e notas, privadas do workspace;
    - editar volta o item para rascunho;
    - só proprietário ou administrador aprova, edita ou arquiva o que já está aprovado.
  - **Simulação:**
    - uma mensagem de exemplo e a resposta sugerida, com a decisão (responder, passar ou não responder) e os campos do script;
    - nada é enviado;
    - até 30 por dia por workspace.
  - **Ativação:**
    - a revisão mostra canais, horário, limite, aprovação, script, passagem e conhecimento, mais avisos e bloqueios;
    - "Ativar agente" e "Pausar" exigem proprietário ou administrador.

## Regras executáveis

- **Configuração:**
  - o schema é estrito: campos de modelo ou chave dão 422, porque a IA é central;
  - os padrões são aprovação de toda resposta, 20 respostas por dia, sem follow-up e horário comercial de São Paulo.
- **Bloqueios da ativação:**
  - sem Pro;
  - contexto da empresa não aprovado;
  - sem definição;
  - nenhum canal, canal de outro workspace ou que não está pronto;
  - canal já atendido por outro agente;
  - gerenciado acima de 20 por dia;
  - responsável que não é membro;
  - conhecimento não aprovado;
  - resposta sem aprovação (só depois do piloto do 07B.2);
  - follow-up (07B.3).
- **Revisão:**
  - o token fica preso à revisão do agente, ao hash da configuração, à versão aprovada do contexto, aos canais escolhidos e à revisão de cada item de conhecimento;
  - qualquer mudança dá 409;
  - confirmar é idempotente por `requestId` e revisão.
- **No banco:**
  - a ativação grava o snapshot do rascunho armazenado, nunca uma configuração enviada pelo chamador;
  - a política dura é reconferida sob trava, e as conexões são travadas;
  - um canal serve a um agente só.
- **Pausa:** tira os vínculos e muda a revisão. Só uma nova revisão e confirmação reativam.
- **Para o 07B.2:** `sdr_agent_for_connection` só devolve o agente se estiver ativo e com:
  - vínculo e canal pronto;
  - Pro vigente;
  - a versão aprovada mais recente do contexto;
  - o conhecimento na mesma revisão aprovada.
  - Fica com o `cadence_worker`.
- **Permissões:**
  - **Rascunho, conhecimento e simulação:** qualquer membro.
  - **Aprovação, ativação e pausa:** proprietário ou administrador.
  - **No banco:** as escritas passam só por funções que conferem o papel, e o plano de outro workspace não pode ser lido.

## Validação executada

- **Unitários:** 4/4 (handoff obrigatório, padrões, schema estrito e bloqueios).
- **Integração focada:** 7/7. Cobre:
  - salvar e simular sem enviar nem ativar, e conhecimento tratado como dado;
  - papéis, entrada estrita e isolamento;
  - bloqueios, revisão presa à configuração, confirmação idempotente e canal de outro workspace;
  - Pro, contexto, responsável, piloto e follow-up;
  - pausa, canal desconectado, contexto e Pro vencido;
  - ciclo do conhecimento, limite de simulação e HTTP 401;
  - os casos da revisão.
- **Regressão focada:** 07C.3b 6/6 e 06F 16/16.
- **Suítes completas:**
  - 428/428 unitários e 608/610 de integração;
  - as duas falhas são `07A.3b assisted` e `07A.3c approving`, que dependem do horário em que rodam (janela comercial depois de avançar dois dias);
  - também falham no HEAD sem esta mudança, então não são regressão do 07B.1;
  - build e tipos com exit 0, e `git diff --check` limpo.

## QA no navegador

Conta descartável `[RE] QA Agente SDR`, com fixture local de assinatura Pro piloto, contexto aprovado e uma conexão WhatsApp `[RE]` marcada como pronta.
- **Sem Pro:** `/sdr` mostrou o gate.
- **Conhecimento:** "[RE] Quanto custa", criado e aprovado pela UI.
- **Agente "[RE] Lucas QA":**
  - definição, uma pergunta (`porte`), canal, responsável, regra e item de conhecimento;
  - salvar manteve os campos, o que confirma a correção H1.
- **Ativação:** a revisão saiu sem bloqueios ([captura](evidence/07b1-sdr-configuration/local-sdr-activation-review.jpg)); "Ativar agente" deixou o agente ativo; "Pausar" pediu confirmação e deixou o agente pausado.
- **Simulação:**
  - a rota de IA central local resolveu para o ChatGPT por OAuth, que você conectou como IA da plataforma;
  - a única tentativa falhou ("A IA não respondeu") e contou no limite;
  - não repeti, para não fazer outras chamadas externas;
  - os dados enviados eram só `[RE]`.
- **375 px:** sem overflow no editor ([captura](evidence/07b1-sdr-configuration/local-sdr-editor-375.jpg)).
- **Limpeza (L-044 removed):** resíduo 0.

## Limites

- **Atendimento das conversas:** um agente ativo não responde (07B.2).
- **Agenda, CRM e follow-up:** ficam para o 07B.3.
- **LinkedIn e e-mail:** LinkedIn fica fora. O e-mail aparece só se houver uma conexão pronta no mesmo cadastro de canais.
- **Simulação com IA real:** não confirmada. A tentativa local falhou e a causa não foi investigada sem nova chamada externa. O caminho com gerador injetado está coberto.
- **Referência:** as telas operacionais não foram observadas; não há paridade declarada.
- **Franquia:** a de 300 conversas não é medida nem exibida.
- **Entrega:** sem push, merge ou deploy.
