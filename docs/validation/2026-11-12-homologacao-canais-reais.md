# Homologação com canais reais — 12/11/2026

Workspace único "Agência Prometeus", conta administradora da plataforma. O operador aprovou no chat os envios para os próprios contatos pessoais.

## Resultado

| Item | Resultado |
| --- | --- |
| Plano | Pro ativo, assinado pelo Checkout do Stripe em modo de teste com cartão de teste. Ativação conferida pela reconciliação com o Stripe |
| IA da plataforma | ChatGPT OAuth como LLM convencional; teste de conexão aprovado |
| Contexto de IA | Leitura do site da agência concluída, com fontes; aceite e aprovação ficam com o operador |
| E-mail | Caixa Gmail conectada por OAuth e pronta; resposta externa recebida; e-mail de teste aceito pelo Gmail |
| WhatsApp | OpenWA v0.30.0 com motor Baileys; QR em segundos; mensagem recebida; teste entregue no aparelho |
| Cadência real | Duas etapas de WhatsApp só para o operador. A etapa 1 foi entregue; a resposta do operador parou a inscrição (`stopped`, motivo `reply`) antes da etapa 2 |

## Defeitos encontrados e corrigidos

- Login falhava pelo endereço `localhost`; em desenvolvimento ele agora redireciona para a origem confiável.
- Conectar Gmail exigia um segundo clique; uma caixa nova vai direto ao consentimento do Google.
- Caixa de e-mail desconectada não saía da lista; agora pode ser removida, preservando o histórico.
- O recebedor do OpenWA recusava todo evento: o `deliveryId` atual vem como `dlv_<uuid>`.
- O motor `whatsapp-web.js` não inicia com o WhatsApp Web atual (`null Socket`); a plataforma passou ao Baileys.
- Contatos chegavam só como `@lid`; o recebedor e a recuperação consultam o telefone no OpenWA.
- Telefone de lead sem +55 bloqueava autorização e publicação de WhatsApp; passa a ser lido como brasileiro.
- A recuperação do OpenWA pausava o número a cada envio por 0,3 s de diferença entre o relógio do OpenWA e o do WhatsApp; agora tolera até 2 minutos.

## Prospecção real — 13/11/2026

Lista "Homologação · Contabilidade RJ 2". Nenhuma mensagem foi enviada a esses leads.

| Etapa | Resultado |
| --- | --- |
| Geração (Maps) | 10 escritórios de contabilidade do Rio em 16 s; 10 inseridos, sem duplicados; US$ 0,04 no Apify |
| IA da plataforma | Chave do Gemini cadastrada pela nova tela de Provedores de IA, guardada cifrada; teste de conexão com `gemini-4-hydrogen` aprovado |
| Contexto de IA | Perfil de cliente ideal preenchido e aprovado (v4); sem ele a IA não decidia aderência |
| Qualificação (8 módulos) | 10 leads em 17 min; 11 chamadas Gemini, 20 execuções Apify (US$ 0,12, 1 tempo esgotado); CNPJ confirmado em 5, 1 lead aderente, 9 pendentes por falta de dado de porte nas fontes |
| Revisão | "Selecionar todos" marcou os 10; endereço da Receita rejeitado num lead e mantido o do Maps; aplicação conferida no banco |

| Enriquecedor | 5 empresas com CNPJ em 10 min; 9 sócios do cadastro registrados na ficha, sem contato pessoal publicado; nenhum crédito comercial consumido; nenhuma lista de decisores criada. US$ 0,16 no Apify (CNPJ 0,04; busca Google 0,06; LinkedIn 0,06) |
| LinkedIn dos sócios | A busca no Google trouxe 8 perfis de outras pessoas; o app descartou todos, sem associar a sócios |

## Agente SDR — 14/11/2026

Agente "SDR Prometeus" no WhatsApp gerenciado, 24 h, aprovação antes de cada resposta, testado só com o número pessoal do operador.

| Caso | Resultado |
| --- | --- |
| Simulador | Resposta coerente com o contexto e pergunta do script |
| Pergunta fora da base (produto Rastro) | Passou a conversa ao responsável e notificou; nada enviado |
| Pergunta coberta pelo contexto | Rascunho em 2 s, campo do script extraído (porte: 12 pessoas), aprovado e entregue no aparelho |

Defeitos encontrados e corrigidos nesta etapa:

- Chaves de OpenAI e Gemini só entravam pelo arquivo de ambiente; agora o administrador da plataforma as cadastra na tela, com validação no provedor.
- O extrator de telefones propunha números sem DDD ou trocava o celular do Maps pelo fixo do site; agora normaliza para +55 com DDD e mantém o telefone que o lead já tem.
- A revisão só aceitava o lead inteiro; agora há "Selecionar todos" e escolha campo a campo.
- A consulta cadastral trocava cidade, estado e endereço já preenchidos pelo formato da Receita; agora só preenche campos vazios.
- O Enriquecedor pagava a leitura de perfis do LinkedIn de outras pessoas; agora só lê o perfil cujo resultado de busca cita o nome do sócio.
- A faixa "teste grátis" aparecia num workspace Pro enquanto o plano carregava; agora só aparece depois de o plano carregar.
- O worker do SDR não lia a política de IA (não é membro de workspace) e bloqueava todo turno como IA indisponível.
- Mensagens do WhatsApp chegam com horário ~3 s adiantado e não abriam a janela de 24 h; a resposta do SDR exigia autorização. Agora aceita até 2 min.
- A recuperação do OpenWA tratava o envio próprio ainda sem confirmação como lacuna e pausava o número.
- O modo de desenvolvimento compilava telas por até 16 s e o navegador desistia aos 15 s ("signal timed out"); a homologação passou a rodar o build de produção.
- A busca de CNPJ falhava com 403: a versão fixada do robô de busca do Google foi removida pelo Apify; fixada a 0.0.489.

- A mesma recuperação contava o envio próprio em andamento como mensagem sem horário (contador do gateway) e pausou o número durante uma resposta do SDR (14/11/2026); corrigido.

## Limites anti-banimento (14/11/2026)

- Com teto de 1 resposta/dia, a 1ª resposta aprovada saiu e a 2ª ficou adiada com `OPENWA_REPLY_LIMIT`; ao voltar o teto a 60 e liberar, foi entregue.
- Antes de cada resposta o contato viu "digitando…" (confirmado pelo operador); o envio levou 9–15 s após a aprovação.
- Após liberar a pausa direto no banco, a recuperação releu a janela e trouxe a mensagem recebida durante a pausa.

## Agentes de IA por módulo, fase 1 (14/11/2026)

- Quatro agentes (Prospecção, LinkedIn, Assistente, Agente SDR) sobre o provedor único da plataforma; cada chamada declara agente e operação, e um agente não executa operação de outro.
- Modelo por agente na configuração de IA (só administrador da plataforma); todos em "Padrão da plataforma (gemini-4-hydrogen)".
- Prova de que nada mudou: 8 pedidos de referência travados antes da mudança e iguais depois; 502/502 testes de unidade; 711/711 de integração (5 pulados, como antes).
- Rodada real no build de produção: assistente respondeu pelo Gemini; simulação do Agente SDR respondeu e indicou passagem para o time; qualificação por IA de 1 lead concluída, com o uso gravado como `agent: prospecting`.

## Google Agenda e Google Planilhas (15/11/2026)

- Configuração da plataforma, feita uma vez pelo administrador no Google Cloud: o mesmo cliente OAuth do Gmail, com Google Calendar API e Google Sheets API ativas, os dois endereços de retorno `/api/integration-oauth/google-calendar/callback` e `/google-sheets/callback` e os escopos `calendar.freebusy`, `calendar.events.owned` e `drive.file`. O app segue em modo de teste no Google (usuários de teste, até 100); abrir para qualquer cliente exige a verificação do app pelo Google.
- Cada empresa só clica em "Conectar conta Google", escolhe o e-mail e autoriza; a conta fica no workspace dela.
- Agenda: disponibilidade seg–sex, 9h–18h, 30 min, 4 h de antecedência, janela de 14 dias; 90 horários livres. Reserva real para o lead de teste em 16/11 às 9h criou o evento sem convite e ocupou o horário; o cancelamento apagou o evento e liberou o horário.
- Planilhas: a planilha "Prometeus Cadence - Leads" foi criada no Drive da conta; um lead criado à mão entrou como linha em segundos (gatilho "Lead gerado").
- Observado: uma mensagem que chega no WhatsApp de um número sem conversa ligada a lead não gera "Lead respondeu", mesmo existindo um lead com esse número; o gatilho vale para lead que responde a uma cadência. Na planilha, as datas saem em UTC (ISO) e a coluna Empresa fica vazia para lead cadastrado à mão (o nome da empresa vai em Nome).

## Agente SDR depois da base de conhecimento (15/11/2026)

- Uma resposta real falhou (`AI_FAILED`): numa conversa com histórico, páginas do site e documentos (cerca de 9 mil tokens de entrada), o modelo gastou 4.093 dos 4.096 tokens de saída pensando e parou por limite antes de responder. A resposta do SDR passou a ter 8.192 tokens de saída; a mesma conversa respondeu com o preço do site. O worker não registra a causa de uma falha de IA, só `AI_FAILED`.
- O agente citava para o lead o nome do arquivo de onde tirou o preço; a fonte agora vai só nas citações.
- Uma falha de IA no worker do SDR agora guarda o código do erro do provedor junto do turno (`usage.error`), sem o texto da mensagem.

## Reteste real dos 4 agentes com entradas grandes (15/11/2026)

Cada operação rodou 2 vezes no Gemini (`gemini-4-hydrogen`) com as 11 páginas do site como evidência. Todas terminaram com `STOP`:

| Agente | Operação | Entrada (tokens) | Pensamento + saída / limite | Tempo |
|---|---|---|---|---|
| Prospecção | Qualificador | 3.372 | até 986 / 4.096 | 4–6 s |
| Prospecção | Decisores | 11.376 | até 555 / 4.096 | 3–4 s |
| Prospecção | Pessoas da empresa | 11.399 | até 474 / 4.096 | 3 s |
| Prospecção | Leitura do site (Contexto de IA) | 14.168 | até 6.406 / 8.192 | 23–28 s |
| Prospecção | Opções de cadência | 13.095 | até 2.597 / 8.192 | 12–14 s |
| LinkedIn | Comentário | 1.090 | até 1.038 / 4.096 | 3–6 s |
| Assistente | Resposta | 919 | até 756 / 4.096 | 3–4 s |
| Agente SDR | Plano de busca | 396 | até 192 / 4.096 | 2 s |
| Agente SDR | Resposta (conversa real) | 8.967 | 3.032 / 8.192 (antes: 4.096 esgotados) | — |

Ponto de atenção: a leitura do site usa até 78% do maior limite que o app aceita (8.192). Um site com mais texto pode esgotar o limite.

## Conversa real com o Agente SDR e queda do número (15–16/11/2026)

- Venda de site: o agente deu o preço fixo sem citar arquivo nem perguntar porte; ao "quero sim", passou para o time.
- Pedido de demonstração: o agente marcou a proposta de horários (`calendar-options`) sem inventar horário e pediu nome, empresa e e-mail; a conversa ligada ao lead gerou "Lead respondeu" na planilha.
- Às 23:55 o número foi pausado sem queda real: a recuperação leu a resposta aprovada do agente já "entregue" e ainda sem o horário do WhatsApp, tratou como buraco (`OPENWA_RECOVERY_GAP`) e ligou a pausa de segurança. Com a pausa, a tela pedia para reconectar o WhatsApp (o celular seguia conectado) e as mensagens recebidas deixaram de entrar. Corrigido: mensagem própria sem horário não é buraco, qualquer que seja o status. Ao liberar o número, a recuperação releu o período pausado e trouxe a resposta do contato.
- A memória da conversa guardou nome, empresa, e-mail e decisor, cada um ligado à mensagem do contato; esses dados não vão para a ficha do lead.
- Pendente: uma pausa de segurança aparece como "precisa reconectar" (o motivo real some da tela) e só sai reconectando; falta o "Retomar envios" e mostrar o motivo.

## Agente SDR com objetivo, qualificação obrigatória e Agenda (16/11/2026)

- Construído a partir da conversa real em que a reunião foi marcada sem o lead escolher. Desenho em `docs/superpowers/specs/2026-11-16-sdr-objectives-design.md`; plano em `docs/superpowers/plans/2026-11-16-sdr-objectives.md`.
- Coberto por testes (Google simulado): oferta de horários reais, recusa de horário fora da oferta, escolha do lead vira proposta, aprovação cria o evento antes de enfileirar a mensagem (convite e Meet), horário ocupado e texto sem a data são recusados, cancelamento reabre a oferta, ligação do lead pelo número escrito de três jeitos, dois leads com o mesmo número não ligam nada, ficha preenche só campos vazios.
- Homologado em conversa real em 16/11/2026 (11:00–11:05), no WhatsApp gerenciado com o contato de teste: agente "SDR Prometeus" com "Marcar reuniões" e duas perguntas obrigatórias (porte, dor). O porte já tinha sido respondido pelo lead em 14/11 e foi reaproveitado; a dor foi perguntada e respondida; o agente ofereceu três horários livres reais da Agenda; o lead escolheu 16/11 às 15:30 e a aprovação da confirmação criou o evento com link do Google Meet e convite, que chegou no Gmail do lead (confirmado pelo operador). A etapa foi a "Objetivo cumprido" e a ficha recebeu nome, empresa, dor, plano, próximo passo e status, sem divergências. O escopo `calendar.events.owned` bastou para criar o Meet.
- Detalhes vistos na homologação: o nome de campo da nova pergunta ficou "campo_2dor" (o campo já vem preenchido e o texto digitado é somado); o painel mostrava "Reunião marcada" para uma reunião já passada. A reunião das 10:00 de 16/11, sem convite nem Meet, foi marcada às 00:08 pela versão anterior do agente.
- O link do Meet vai no convite por e-mail, não no texto do WhatsApp: o texto aprovado é enviado exatamente como revisado.

## Pendências

- Cadência por e-mail exige endereço HTTPS público para o descadastro (08B).
- Mensagens recebidas enquanto o número está pausado não são relidas ao liberar.

## Melhorias pedidas pelo operador

- **Inbox do WhatsApp mais próxima do WhatsApp Web**, mantendo a identidade do Cadence: lista de conversas e conversa lado a lado, conversa com rolagem própria que abre nas mensagens mais recentes (sem descer a página inteira), histórico antigo carregado sob demanda ao subir, emojis e mais recursos de resposta direto na conversa, mantendo o cache e a paginação do histórico. Divergência visual em relação ao CadenceFlow: precisa de aprovação explícita ou fica para a personalização Prometeus.
- **"Retomar envios" sem reconectar**: hoje, depois de uma pausa de segurança do número, a única forma de liberar é reconectar o WhatsApp. Um botão de retomada após revisar as mensagens do período evita a reconexão.
- **Um workspace por usuário comum** (pedido em 14/11/2026): usuário comum cria e usa só 1 workspace; o administrador da plataforma pode ter vários, cada um totalmente isolado. A definir: se um usuário comum convidado como membro do workspace de outra empresa conta nesse limite.
- **Base de conhecimento da empresa com busca vetorial (RAG) para o Agente SDR** (em desenho, 14/11/2026): além da base direta de FAQ e notas, documentos da empresa com embeddings Gemini em pgvector, isolados por workspace, e memória de longo prazo da conversa.
- **Um agente de IA por módulo** (aprovado como direção em 14/11/2026): prospecção (gerador, qualificador, enriquecedor e script automático das cadências), LinkedIn, assistente do app (suporte, automações, contexto, configurações) e Agente SDR, cada um com perfil próprio (instruções, ferramentas permitidas, modelo, limites e custo medido), sobre a camada de IA, o RLS, a fila e a base de conhecimento compartilhados. Desenho próprio, depois da base de conhecimento do SDR.
- **Etapa do agente Assistente** (aprovada como direção em 15/11/2026): separar o suporte de uso do app, que responde só pela Central de Ajuda, das tarefas de configuração (Contexto de IA, automações, público), que podem usar a base de conhecimento da empresa. A leitura do site para o Contexto de IA passa do agente de Prospecção para o Assistente, e o site lido entra na base como documento.
