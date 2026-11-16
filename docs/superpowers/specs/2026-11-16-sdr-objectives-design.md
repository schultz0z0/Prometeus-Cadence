# Agente SDR com objetivo, qualificação obrigatória e Agenda — desenho

Data: 16/11/2026. Pedido do operador (Prometeus) durante a homologação real do Agente SDR. Escopo: **só o Agente SDR**. Os agentes de Prospecção, LinkedIn e Assistente não mudam.

## Por quê

Na homologação de 15–16/11, o agente percebeu o pedido de demonstração e disse "a equipe vai enviar opções de horários". Ninguém enviou. Uma pessoa da equipe marcou um horário sem o lead escolher, e o lead só soube a data porque perguntou. O operador quer um SDR que conduza a conversa com técnica de vendas até o objetivo da empresa:

- marcar reuniões, usando a Google Agenda conectada;
- vender direto, enviando o link de fechamento;
- ou qualificar e passar para um vendedor humano.

O objetivo depende de cada empresa. Um e-commerce não precisa de Agenda.

## Regras fixas (valem para os três objetivos)

1. **Primeiro qualifica.** O agente só oferece horários, envia o link de venda ou passa para o vendedor depois que todas as perguntas **obrigatórias** do script de qualificação foram respondidas nesta conversa. O app garante isso, não o modelo.
2. **Sempre atualiza a ficha do lead.** A cada turno, o app grava na ficha do lead o que a conversa revelou (ver "Ficha do lead").

## Objetivos

Novo campo na configuração do agente: `objective` = `meetings` | `direct-sale` | `qualify-handoff`. O padrão para agentes existentes é `qualify-handoff`, que é o comportamento mais próximo do atual: qualifica e passa.

### Marcar reuniões (`meetings`)

- **Ativação:** bloqueada sem Google Agenda conectada e com disponibilidade salva, com a mensagem "Conecte a Google Agenda em Configurações → CRM e apps para o agente marcar reuniões."
- **Horários válidos:** a "Disponibilidade" da página da Agenda (dias, início e fim, duração, antecedência mínima, janela e fuso) menos o que já está ocupado na agenda principal. É o mesmo cálculo de `readCalendarSlots`.
- **Fluxo:**
  1. Qualificado, o agente propõe a reunião, mesmo que o lead não peça.
  2. Na etapa de oferta, o **app** busca os horários livres antes de chamar o modelo e entrega uma lista curta (até 6, espalhados em pelo menos 2 dias).
  3. O modelo escreve a mensagem com 2 ou 3 opções dessa lista e devolve quais ofereceu. Ele nunca escreve um horário fora da lista: o app confere e recusa o rascunho, pedindo outro.
  4. O lead escolhe. O modelo devolve qual opção foi escolhida, ou "nenhuma", ou "pediu outro dia ou horário" com a preferência em texto.
  5. Em "pediu outro", o app busca de novo, respeitando a preferência quando der (dia da semana, manhã ou tarde), e o agente oferece novas opções.
  6. Escolhido o horário, o app confere de novo que está livre (o horário oferecido pode ter sido ocupado). Se estiver livre, o rascunho de confirmação já traz a reunião a criar. Se estiver ocupado, o agente pede desculpas e oferece outros.
  7. **Com aprovação** (`approvalMode='all'`): um clique de "Aprovar" envia a confirmação **e** cria o evento. Se o evento falhar, a mensagem não sai, e a conversa mostra o erro e as opções.
  8. **Sem aprovação** (`bounded-auto`, ainda travado até o piloto): cria o evento e envia. O desenho já prevê isso, mas o modo não é liberado nesta entrega.
- **Confirmação ao lead:** sai sem ele pedir, com dia da semana, data, hora, fuso quando for diferente do lead, duração e formato (online).
- **Convite (decidido pelo operador em 16/11/2026):** o evento convida o lead pelo e-mail que ele informou e gera link do Google Meet. A confirmação pelo WhatsApp leva o link. Sem e-mail do lead, a reunião é marcada mesmo assim, e o link vai só pelo WhatsApp. Hoje o evento sai com `sendUpdates=none` e sem convidados: passa a ter `attendees` quando houver e-mail, `sendUpdates=all` e `conferenceData.createRequest` (Meet). Se o escopo `calendar.events.owned` não bastar para criar o Meet, o construtor registra o escopo adicional, e o operador reconecta a Agenda uma vez.
- **Evento criado e mensagem não entregue (decisão do construtor):** o evento é criado antes, e a mensagem só entra na fila depois que o evento existe. Se o envio falhar ou ficar incerto, o evento fica. A conversa mostra "Reunião marcada, confirmação não entregue" e avisa o responsável pela passagem.
- **Rascunho editado (decisão do construtor):** quem aprova pode editar o texto. O horário da reunião vem da oferta escolhida, não do texto. Se o texto editado não trouxer mais a data e a hora marcadas, a aprovação avisa antes de enviar.
- **Depois de marcada:** o agente não oferece outros horários, como já é hoje com `meeting`. Pedido de remarcar ou cancelar vai para o time (regra de passagem fixa). Se a reunião for cancelada à mão, a conversa volta para `qualified`.
- **Fuso (decisão do construtor):** a confirmação sempre diz o fuso da agenda por extenso (ex.: "horário de Brasília"). O app não sabe o fuso do lead.
- **Botões da conversa:** "Ver horários da agenda" e "Confirmar reunião" continuam existindo para a pessoa da equipe marcar à mão, mas não são mais o caminho principal.

### Vender direto (`direct-sale`)

- **Configuração:** forma de fechamento, um rótulo livre (ex.: "link de pagamento", "checkout", "página do site"), e o link de fechamento, uma URL https obrigatória.
- **Fluxo:** qualificado e com interesse confirmado, o agente apresenta a oferta e envia o link configurado. O link sai exatamente como configurado: o app confere que a resposta contém a URL e não contém outra URL.
- **Fim da conversa:** depois do link, a conversa vai para a etapa "concluída" (link enviado). Dúvida de pagamento, desconto ou problema vira passagem para o time.
- Preço continua sob as regras atuais (só com fonte aprovada; alerta de valor sem fonte).

### Qualificar e passar (`qualify-handoff`)

- **Fluxo:** o agente conversa até entender a dor, levantar as informações e esboçar um plano de solução. Qualificado, ele avisa o lead que um especialista vai continuar e passa para o membro de "Passagem para o time", que já é notificado hoje.
- A passagem inclui o resumo (ver "Ficha do lead") na notificação e na ficha.

## Etapas (o app controla)

Por conversa, em `sdr_thread_state`:

- `stage`: `qualifying` → `qualified` → `offer` → `done`. Passar para o time ou ser assumido por uma pessoa continua como hoje (`owner='human'`).
- `answers`: as respostas acumuladas do script `{field: {value, messageId}}`. Hoje elas só ficam em cada turno (`sdr_turn.fields`).
- `offer`: para reuniões, os horários oferecidos (início, fim e fuso), e para venda direta, quando o link foi enviado.

Regras:

- `qualifying` → `qualified` quando todas as obrigatórias estão em `answers`. Sem perguntas obrigatórias, a passagem é imediata: o script fica a cargo da empresa, e o desenho não inventa perguntas.
- Em `qualifying`, o prompt pede a próxima pergunta obrigatória que falta, uma por vez, e proíbe oferta, link e passagem por objetivo. A passagem pelas regras da empresa (reclamação etc.) continua valendo em qualquer etapa.
- Em `qualified`, o prompt pede a ação do objetivo. Para reuniões, o app já entra em `offer` com os horários carregados.
- **Obrigatória sem resposta (decisão do construtor):** depois de 2 perguntas sem resposta sobre o mesmo campo, ou quando o lead se recusa a responder, a conversa passa para o time, com o motivo "não respondeu a pergunta obrigatória: …".
- **Só vale resposta desta conversa:** uma resposta conta quando o modelo a devolve em `fields` apontando uma mensagem do lead (`messageId`), como os fatos da memória.
- **Limite de chamadas (decisão do construtor):** nas etapas `offer` e de confirmação, a busca nos documentos só roda se a mensagem do lead tiver uma pergunta. Se a conferência do rascunho (horário fora da lista ou URL errada) falhar e não sobrar chamada, o turno se abstém e uma pessoa assume.
- **Depois de `done` (decisão do construtor):** o agente continua tirando dúvidas, mas não oferece de novo nem envia o link de novo. Uma conversa não volta para `qualifying` sozinha.

## Ficha do lead

- **Contato:** o modelo devolve `contact` com nome da pessoa, e-mail, telefone e empresa, cada um com o `messageId` de onde saiu. Os fatos da memória longa já funcionam assim.
  - O app grava só nos campos **vazios** da ficha.
  - Valor diferente do que já existe não sobrescreve: aparece na conversa e na ficha como "o lead informou outro e-mail: …", com botão para aplicar.
  - A ficha não tem campo para o nome da pessoa (só `name` e `companyName` da empresa). O nome da pessoa vai no bloco abaixo.
- **Bloco novo na página do lead:** "Conversa com o Agente SDR", com:
  - dor;
  - informações levantadas (respostas do script e fatos);
  - plano de solução;
  - próximo passo;
  - etapa e status (ex.: "Reunião marcada 17/11 10:00", "Link enviado", "Passado para Fulano");
  - data da última atualização.

  Fica separado de "Resumo & Status" e "Observação IA", que vêm da pesquisa e do Qualificador e não são tocados.
- **Ligação automática com o lead (decidido pelo operador em 16/11/2026):** quando o agente começa a atender uma conversa sem lead ligado, o app procura o lead pelo telefone, comparando os números normalizados. No teste, o lead tinha `21964342764` e a conversa `+5521964342764`, e não foram ligados.
  - Exatamente um lead com o número: liga a conversa a ele, com a evidência "mesmo número de WhatsApp".
  - Nenhum lead: cria um lead novo (origem "Agente SDR", lista padrão do agente, nome provisório pelo número ou pelo nome do perfil do WhatsApp, quando houver). A ficha vai sendo preenchida durante a conversa.
  - Mais de um lead: não liga. A conversa mostra "Escolha o contato" e o agente continua atendendo, mas sem marcar reunião nem gravar na ficha até alguém escolher.
- Ligações automáticas e leads criados pelo agente ficam marcados assim na ficha e na conversa, e podem ser desfeitos pela pessoa.

## Técnica de vendas

A regra fixa do agente ganha um roteiro curto por objetivo e etapa. Exemplos: perguntas abertas sobre a dor, uma pergunta por mensagem, resumir o que entendeu antes de propor, propor o próximo passo com opções concretas, tratar objeção sem insistir e não pressionar. As instruções da empresa continuam definindo identidade, tom e oferta, e não mudam as regras.

## Configuração (tela do agente)

- **Objetivo:** escolha entre os três, com uma linha explicando cada um.
- **Reuniões:** mostra o estado da Agenda ("Conectada · seg–sex 9h–18h · 30 min" ou "Conectar Google Agenda") e um link para a página da Agenda.
- **Venda direta:** campos "Forma de fechamento" e "Link de fechamento".
- **Script:** um aviso quando não há pergunta obrigatória: "Sem pergunta obrigatória, o agente passa direto para o objetivo."

## Abordagens consideradas

- **A. Tudo pelo prompt:** é rápido, mas "qualifica antes" ficaria a critério do modelo, que já pulou etapas no teste. Descartada.
- **B. Etapas controladas pelo app, com a IA conversando:** escolhida pelo operador em 16/11/2026. O app guarda etapa e respostas, libera a ação só quando as obrigatórias estão respondidas, busca os horários reais e confere a escolha. A IA escreve.
- **C. A IA chamando ferramentas por conta própria (estilo LangGraph):** difícil de travar com aprovação e "qualifica antes", e contraria o fluxo nativo escolhido em 14/11. Descartada.

## Restrições

- Fluxo nativo, sem LangGraph. As chamadas continuam em `composeSdrReply`: no máximo 3 chamadas de modelo, orçamentos de 4.096 ou 8.192 tokens (a resposta usa 8.192).
- O identificador de horário de hoje (`sealSlot`) vale 5 minutos (`SLOT_TTL`). Um horário oferecido ao lead vale enquanto a oferta estiver aberta (até o fim da janela da disponibilidade), então a oferta guarda início e fim, e a reserva confere a disponibilidade de novo antes de criar.
- A proteção atual contra reserva dupla e reserva incerta (`begin_calendar_reservation` e outras) é reaproveitada, sem duplicar a lógica.
- RLS e isolamento por workspace como no resto do SDR. A ficha do lead só muda pela conversa ligada a ela.
- Fidelidade: o CadenceFlow mostra "Agenda e registra no CRM", mas o comportamento não foi observado. Isso vira divergência registrada no AGENTS.md.

## Fora do escopo

- Outros agentes (Prospecção, LinkedIn, Assistente).
- Liberar o modo sem aprovação: continua travado até o piloto.
- Cobrar ou processar pagamento dentro do app: a venda direta só envia o link da empresa.
- CRM externo.
- Remarcar ou cancelar pelo agente: vai para o time.

## O que não pode acontecer

- O agente escrever um horário que não veio da Agenda, ou marcar sem o lead escolher.
- Oferecer reunião, link ou passagem por objetivo antes das obrigatórias.
- Sobrescrever dado bom da ficha com o que o lead digitou, sem a pessoa conferir.
- A mensagem de confirmação sair e o evento não existir, ou o contrário.

## Para o construtor decidir

- Formato exato dos campos novos na saída do modelo e no esquema JSON.
- Como espalhar os até 6 horários entre os dias.
- O texto do roteiro de técnica por etapa, dentro do limite de frases da resposta.
- Onde mostrar a divergência de contato na conversa.
- Migração dos agentes existentes para `qualify-handoff`, sem exigir reativação. A configuração ativa só muda quando o operador salvar e ativar.
