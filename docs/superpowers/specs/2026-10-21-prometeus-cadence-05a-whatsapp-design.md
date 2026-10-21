# Marco 05A — WhatsApp Meta/Twilio, execução e inbox

Data: 21/10/2026. Estado: **desenho e plano aprovados; implementação nativa em andamento**. Base: `0a2b5a7`, com correções dos contratos de prospecção e piloto real do marco 04. O usuário reservou a configuração manual dos provedores e o piloto externo para o final.

Pesquisa: [Meta/Twilio](../../research/2026-10-21-meta-twilio-whatsapp-study.md). Referência de UX: `docs/reverse-engineering/FINDINGS.md`, `SURFACE-MAP.md` e prints preservados. Não houve nova inspeção autenticada do concorrente; Twilio decorre da escolha do usuário.

## 1. Intenção e recorte

Uma empresa que crie conta e workspace vazios deve conseguir conectar sua própria conta Meta Cloud API ou Twilio na plataforma, revisar mensagens e operar seu WhatsApp com isolamento dos outros clientes. O primeiro piloto usará Meta; o usuário já possui Meta Business, mas precisa preparar API/aplicativo.

O marco 05 do roteiro contém WhatsApp e e-mail. Propõe-se executá-lo em dois blocos revisáveis: **05A: ambos os provedores WhatsApp, outbox/cadências e inbox; 05B: envio/recebimento de e-mail**. O marco 05 integral só será concluído após ambos. Etapas EMAIL/LinkedIn não habilitadas não podem ser silenciosamente puladas nem enviadas pelo provedor WhatsApp.

Sucesso do 05A: dois workspaces com conexões próprias e dados isolados; conexão real Meta pelo formulário; envio confirmado a contato de teste, resposta na inbox e interrupção comprovada das etapas futuras. Twilio terá o mesmo contrato de produto e testes locais; seu aceite externo só será afirmado quando executado com conta/remetente reais próprios. Credencial ausente aparece como indisponível, sem fallback para a conta de outra empresa.

## 2. Abordagem proposta

**Conexão guiada com contas próprias.** Formulários e instruções dentro do app; cliente prepara os ativos exigidos no console do provedor, informa suas credenciais, verifica acesso/remetente e configura callback gerado. Nenhuma edição de `.env` por cliente, chave WhatsApp global compartilhada ou intervenção manual no banco para ativar a conexão. Consumo do provedor pertence à conta conectada do cliente.

Alternativa Embedded Signup: login integrado Meta com fluxo Tech Provider/revisão e, na modalidade ISV Twilio, Partner Solution/subcontas. É outra entrega de onboarding, com dependências externas. Não oferecer botão de login que simule esse processo nem prometer dispensa de requisitos do provedor pela conexão manual. [Guia oficial](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide).

Alternativa por variáveis globais fica rejeitada: não atende ao workspace vazio e ao controle de conta exigido. QR, Z-API e conectores não oficiais não entram no 05A.

## 3. Jornada de conexão

Em Configurações › WhatsApp, manter a hierarquia visual da referência e oferecer **Meta Cloud API** e **Twilio WhatsApp**. A empresa pode ter mais de um remetente; cada cadência escolhe explicitamente um deles. Não alternar automaticamente entre provedores.

Fluxo: escolher provedor → informar dados → salvar conexão pendente → verificar credenciais/ativos sem enviar → configurar recebimento → sincronizar templates → revisar teste/ativação. Mostrar estados separados: não configurado, pendente, credenciais verificadas, aguardando webhook, pronto, atenção/expirado e desconectado. Salvar segredo não comprova conexão pronta. Challenge aceito não comprova que uma mensagem entrou na inbox.

Meta pede identificação amigável, App ID, App Secret, WABA ID, Phone Number ID e access token. O verify token é gerado pelo app para aquela conexão, distinto dos demais segredos. Campos avançados têm explicação e link ao painel; exemplos não preenchem dados fictícios como credencial real. O assistente inclui preparação do aplicativo, permissões e número de teste.

Twilio pede identificação, Account SID, API Key SID/secret para REST, Auth Token da conta para callbacks e remetente WhatsApp habilitado. Account SID/Auth Token pode ser um modo explícito de autenticação quando a operação exigir. Messaging Service SID só é usado se pertence à conta e contém o remetente escolhido; nunca deixar o pool selecionar silenciosamente outro número. Número habilitado na conta é pré-requisito, não resultado presumido de colar um SID.

Readbacks mostram nomes, identificadores necessários, status e presença de segredo. Segredos são somente escrita: campo vazio preserva o existente, substituição e desconexão são ações distintas. Validar/testar são botões diferentes; somente o teste com destinatário e conteúdo revisados permite enviar uma mensagem.

## 4. Propriedade, segredos e permissões

Conexões, remetentes, templates, conversas, mensagens, consentimentos, supressões e tentativas possuem `workspace_id`, RLS e FKs compostas onde aplicável. WABA/Account SID verificado e remetente confirmado não podem ser associados a outro workspace. Não reservar identidade externa só porque alguém digitou seu ID: primeiro verificar acesso e vínculo remoto.

Proprietário/administrador gerencia credenciais, conexão, publicação e ativação de cadências. Operador pode acessar a inbox e confirmar respostas manuais dentro das permissões do workspace; não lê segredos nem habilita campanhas. Revalidar membro/papel atual antes de mutações e despachos. Toda alteração tem autor e auditoria sem credenciais/corpos sensíveis por padrão.

Cifrar os segredos no servidor com AES-256-GCM e nonce independente; AAD vincula workspace, conexão, provedor e revisão. Chaves de cifra com identificação/rotação ficam no ambiente do servidor, separadas do banco e do segredo de sessão. Ausência de chave bloqueia gravação e envio, sem armazenamento em texto puro. O browser não persiste esses valores em localStorage, sessionStorage, logs ou parâmetros de URL.

O worker acessa somente credenciais necessárias ao trabalho validado. Rotação incrementa revisão, invalida verificações pendentes e impede novos despachos com configuração velha. Desconexão pausa novos envios, preserva histórico e identifica mensagens já em voo; recebimentos tardios autenticados atualizam apenas os registros permitidos, sem reativar cadência. Não revogar ativos no provedor implicitamente ao desconectar no produto.

## 5. Adaptadores e verificação

Contrato interno: verificar ativos, listar remetentes/templates, preparar envio, enviar uma vez, interpretar callback e reconciliar por identificador conhecido. Hosts de API são fixados pelo servidor; usuário não informa URL de API arbitrária. Respostas possuem limites de tamanho, timeout, códigos normalizados e mensagens recuperáveis sem tokens.

Meta: JSON/Bearer em `graph.facebook.com/{version}/{phoneNumberId}/messages`; versão candidata fixada `v26.0`, sujeita ao aceite autenticado. A sonda pública da pesquisa não valida envio. Não usar `latest`, mudar versão silenciosamente ou chamar API On-Premises depreciada. Conferir Phone Number ID dentro da WABA e token com acesso aos ativos; token temporário serve apenas ao teste e seu prazo deve aparecer quando conhecido.

Twilio: formulário em `api.twilio.com/2010-04-01/Accounts/{accountSid}/Messages.json`; API Key autentica REST e Auth Token valida callbacks conforme documentação. Templates usam `ContentSid`/`ContentVariables`, sem `Body` simultâneo. Manter limites de capacidades explícitos; recursos/regions não verificados não são anunciados como suportados. [Mensagens Meta](https://www.postman.com/meta/whatsapp-business-platform/folder/o48mro7/messages), [Mensagens Twilio](https://www.twilio.com/docs/messaging/api/message-resource).

## 6. Webhooks e vínculo de tenant

Callbacks propostos: `/api/channel-webhooks/meta/{publicId}` e `/api/channel-webhooks/twilio/{publicId}/{messages|status}`. `publicId` opaco localiza uma conexão, não autentica o evento. O workspace vem do registro dessa conexão, nunca de campo enviado pelo provedor ou de workspace arbitrário na URL.

Meta: GET responde ao challenge somente com mode/token válidos. POST verifica `X-Hub-Signature-256` sobre os bytes originais com App Secret, em tempo constante, antes do parse. Cada entry WABA e Phone Number ID deve pertencer à conexão; eventos de template/conta sem telefone seguem apenas o escopo WABA. Processar batches e mensagens/status independentemente. Cadastrar callback/assinatura WABA é ação explícita no assistente, sem sobrescrever configuração remota de outro sistema silenciosamente.

Twilio: validar `X-Twilio-Signature` pelo SDK oficial, com Auth Token correto, URL externa canônica e todos os campos recebidos. Não reconstruir essa URL por headers de proxy não confiáveis. Conferir Account SID e remetente no vínculo. Entrada/status não exigem sessão web, mas nenhuma assinatura inválida pode escrever dados. [Segurança Twilio](https://www.twilio.com/docs/usage/security), [amostra primária Graph para assinatura](https://raw.githubusercontent.com/fbsamples/messenger-platform-samples/main/messenger-api/messenger-api-and-webhooks/app.py).

Persistir o evento autenticado antes do 2xx e processá-lo idempotentemente. Falha ao persistir permite redelivery do provedor; evento repetido não duplica mensagem, resposta ou uso. Body desconhecido autenticado é registrado de forma limitada/sem execução; rejeitar incompatibilidade de conta. Status fora de ordem preservam histórico e não regridem delivered/read para sent. Falha posterior não deve apagar evidência de entrega/leitura já confirmada.

Ingress público deve executar por papel servidor mínimo e funções com escopo de conexão, sem conceder à rota anônima o CRUD de todos os workspaces. Estado/eventos e worker usam o PostgreSQL existente. Limitar callback a 1 MiB antes do parse; rejeição por tamanho não pode aceitar só um prefixo do batch. Por padrão guardar hash/identificadores e evento normalizado necessário ao histórico, sem corpo bruto duplicado. Metadados técnicos detalhados de ingestão expiram em 90 dias, preservando mensagens e recibos necessários ao histórico do workspace. Respostas REST limitadas a 2 MiB e chamadas com timeout de até 30 segundos.

## 7. Consentimento, janela e templates

Registrar opt-in com contato, finalidade/escopo, origem, momento e autor/evidência; opt-out cria supressão vigente. Telefone prospectado não autoriza contato WhatsApp. Mensagem espontânea recebida abre a janela de atendimento, sem conceder automaticamente autorização para campanhas futuras irrestritas. [Política primária WhatsApp](https://whatsappbusiness.com/policy/), [regras documentadas pela Twilio](https://www.twilio.com/docs/whatsapp/api).

Texto livre somente com janela válida de 24 horas após a última mensagem recebida. Entrega, leitura e mensagens enviadas não renovam essa janela. Usar timestamp autenticado da mensagem, não o horário de uma redelivery; mensagens antigas não reabrem janela vencida e timestamps futuros inconsistentes não autorizam envio. Fora da janela, exigir template atualmente aprovado, idioma/componentes correspondentes e variáveis compatíveis. [Janela](https://www.twilio.com/docs/whatsapp/key-concepts).

Biblioteca de templates da conexão é distinta dos templates locais de redação. Sincronizar status, idioma, conteúdo e esquema de parâmetros com a fonte, mantendo hash/revisão. Uma etapa vincula template de um remetente/provedor compatível. Alterar mensagem ou trocar template exige nova revisão da cadência. Gerar com IA não publica nem submete conteúdo automaticamente à Meta. Conteúdo do lead/site continua dado não confiável.

A ativação apresenta bloqueios por etapa: sem opt-in, remetente indisponível, template pendente/rejeitado, variável vazia, canal não habilitado ou limite insuficiente. Não usar todo o texto da IA como variável para driblar aprovação. Se a janela fechar após a ativação, bloquear/aguardar revisão conforme configuração explícita; não adaptar o texto nem trocar template sozinho.

## 8. Publicação e execução de cadências

Salvar rascunho preserva o comportamento atual. Preparar ativação é read-only e apresenta snapshot, destinatários elegíveis, remetente, etapas, horários e limites. Confirmar cria versão publicada imutável e inscrições idempotentes; editar o rascunho depois não muda envios já autorizados. Reativação não reaproveita autorização vencida após mudanças de conexão, contexto, mensagem, destinatário ou papel.

Outbox de mensagens no PostgreSQL, worker de envio separado, usando os mesmos padrões de transação, fencing, auditoria e uso já validados. Não criar lead/lista fictícios para acomodar conversa recebida sem lead. Não instalar Redis, broker ou outro banco para este bloco.

Inscrição guarda próxima etapa e horário. `delayDays` representa espera em dias corridos entre a aceitação da etapa anterior e a próxima; primeiro atraso parte da inscrição. Depois aplicar dias/horário/fuso permitidos, com regras determinísticas para DST. Feriados só podem alterar agenda quando há calendário explícito configurado; a UI deve bloquear a opção se não existir esse calendário. Sem rajada de etapas vencidas após downtime: no máximo uma etapa elegível por inscrição, sem despachar etapas posteriores antes da precedente.

Antes do envio, revalidar publicação, inscrição, papel, conexão/revisão, elegibilidade, opt-out, resposta, janela/template e orçamento. Limites de workspace e do remetente são compartilhados por todas as cadências e respostas manuais; testes concorrentes devem comprovar que duas cadências não ultrapassam o teto. Desconhecimento de limite remoto não permite inventar capacidade: aplicar teto local explícito e tratar os retornos reais do provedor.

Cada mensagem tem intenção durável e tentativa identificada antes do POST. Após aceitação, persistir ID remoto e consumo; aceite REST não equivale a delivered/read. Não prometer exactly-once num timeout externo: resposta perdida vira estado incerto e bloqueia repetição automática, inclusive por outro provedor. Reconciliar por ID conhecido/callback ou decisão administrativa comprovada. Retry automático só quando há prova de que não houve aceitação: no máximo duas tentativas adicionais, backoff de pelo menos 30 segundos e respeito ao Retry-After, limites e janela. Configuração inválida, credencial recusada e estado incerto não recebem esse retry.

Custos desconhecidos ficam desconhecidos. Falha de entrega não implica custo zero nem devolução automática de toda quota. Uma tentativa já confirmada não pode consumir a mesma unidade duas vezes por replay do worker/callback.

## 9. Inbox e interrupção por resposta

Conversas e mensagens vêm do servidor. Manter lista, busca, não lidas, vínculo com lead e histórico, com seletor/remetente quando necessário. Exemplo demonstrativo permanece explicitamente separado do modo real. Entrada sem lead cria apenas conversa/identidade do canal; associação à empresa depende de vínculo verificável/revisão.

Guardar ID externo opaco e telefone opcional. Tratar BSUID/ExternalUserId no escopo do provedor/portfolio, sem impor regex de telefone a toda identidade recebida. Não fazer merge global de contatos por BSUID. Anexos recebidos aparecem como eventos suportados; download/upload/renderização completa de mídia não é condição de aceite deste bloco.

Resposta manual: editar → prévia com variáveis resolvidas → confirmar → outbox. Aplicar as mesmas regras de janela/consentimento/template e limites do envio automático. IA pode propor texto, sem responder automaticamente. Abrir conversa ou marcar lida no app não é autorização de envio.

Ao persistir resposta válida, marcar a inscrição para parar e cancelar os próximos envios elegíveis, inclusive passos de outro canal quando `stopOnReply` estiver ativo. Opt-out suprime contato e interrompe inscrições abrangidas. Worker revalida imediatamente antes do despacho. Mensagem já aceita/em voo pode não ser cancelável; a UI deve mostrar esse limite sem alegar recolhimento remoto.

## 10. Modelo e interfaces a detalhar no plano

Entidades separadas: conexão/credencial cifrada; remetente e capacidades; template remoto; identidade de contato; conversa; mensagem/outbox; evento recebido; publicação de cadência; inscrição; tentativa de despacho; opt-in e supressão. Mensagem recebida aceita `lead_id` nulo. IDs remotos têm unicidade no escopo correto; inscrições e intenções de envio têm chaves idempotentes próprias.

Serviços de configuração, sync/validação e teste ficam separados de publicação/despacho e ingestão de callbacks. APIs de operador não incluem segredos. Toda mutação de usuário mantém origem confiável, sessão, workspace, schema, revisão e request ID; callbacks seguem assinatura própria. Migrações são aditivas após 020, sem modificar checksums anteriores ou recriar volumes. DTOs e testes de contrato precedem a implementação das telas.

## 11. Aceite e validação

| Caso | Evidência esperada |
| --- | --- |
| Workspace vazio | Conecta Meta/Twilio pelo app; nenhuma variável de cliente exigida no deploy |
| Isolamento | Dois workspaces não leem/alteram credenciais, templates, conversas, consentimentos ou mensagens um do outro |
| Segurança do callback | Assinatura inválida, conta/remetente divergentes, corpo alterado e URL Twilio divergente não escrevem dados |
| Recuperação | Evento duplicado/fora de ordem, reinício do worker, lease vencido e resposta REST perdida não provocam novo POST cego |
| Controle humano | Save/geração não enviam; ativação/teste/resposta manual têm confirmação e revalidação de autoridade |
| Janela/template | Fronteira de 24h, template removido/rejeitado, variável faltante e opt-out bloqueiam o envio |
| Concorrência | Duas cadências e envio manual respeitam o limite agregado do mesmo remetente |
| Conversa sem telefone | Identidade opaca entra na inbox sem inventar número/empresa ou cruzar portfolios |
| Interrupção | Resposta e opt-out cancelam etapas pendentes; evento tardio não reabre a régua |
| Meta real | Conta do usuário conectada na UI, template de teste, uma mensagem ao contato autorizado, callback/resposta reais e follow-up impedido |
| Twilio | Contrato/fixtures e mesmos casos de segurança; teste externo somente com conta/remetente disponíveis, identificado separadamente |

Suíte padrão não chama provedores nem envia mensagens. Aceite Meta externo exige destinatário, conteúdo, teto e confirmação próprios; não usar o lead For Derm Clinic. O setup não envia teste automaticamente. O painel deve distinguir configuração salva, contrato testado e mensagem realmente recebida/entregue.

## 12. Dependências externas e limites desta proposta

O piloto precisa de aplicativo/ativos Meta e endpoint HTTPS público para callbacks. Essas dependências não existem ainda nesta entrega. Preparar instruções/configuração e testes locais não implica aceitar termos, expor o app inteiro, publicar serviço ou criar conta/credencial em nome do usuário. Quando a implementação estiver pronta, a exposição terá destino e escopo concretos para revisão.

E-mail permanece no bloco 05B. Embedded Signup, QR, SDR autônomo, LinkedIn, processamento completo de anexos, faturamento do SaaS e campanhas de produção em escala ficam fora do 05A. O roteamento JEV/Codex existente permanece: JEV nunca opera sozinho; conteúdo de IA é revisável. Nenhuma melhoria de texto será apresentada como fine-tuning realizado.

Próximo passo após revisão desta especificação: plano executável do 05A, com contratos, arquivos, migrações, fixtures e critérios de teste; execução nativa preservada.
