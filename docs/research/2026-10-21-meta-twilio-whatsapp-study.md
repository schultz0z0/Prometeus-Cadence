# WhatsApp Meta e Twilio — pesquisa para o marco 05

Data: 21/10/2026. Base local: `0a2b5a7`. Pesquisa de documentação e código público; nenhum login, token, cadastro externo, assinatura, conexão ou envio efetuado.

## Pedido e conclusão

O usuário escolheu **Meta Cloud API e Twilio como duas opções de WhatsApp**, com primeiro piloto na Meta. Cada empresa deve conectar suas próprias contas no aplicativo, partindo de um workspace vazio. O usuário possui Meta Business, mas ainda precisa configurar aplicativo/API.

Recomendação de arquitetura: conexão guiada com credenciais próprias, persistência cifrada por workspace e adaptadores independentes. A cobrança do provedor permanece na conta do cliente. Embedded Signup é outra modalidade de onboarding, com requisitos externos próprios; não é equivalente a salvar uma chave de API. Não inferimos dispensa de verificações/regras do provedor por usar conexão manual.

## Contratos pesquisados

| Item | Meta Cloud API | Twilio WhatsApp |
| --- | --- | --- |
| Conta/remetente | WABA e Phone Number ID do cliente | Account SID e remetente WhatsApp habilitado do cliente |
| Autenticação de envio | Bearer access token com permissões compatíveis | HTTP Basic: API Key SID/secret e Account SID; Account SID/Auth Token quando a operação exigir |
| Envio | `POST graph.facebook.com/{version}/{phoneNumberId}/messages`, JSON | `POST api.twilio.com/2010-04-01/Accounts/{accountSid}/Messages.json`, formulário |
| Template | Identidade/nome, idioma e componentes aprovados | `ContentSid` e `ContentVariables`; não combinar com `Body`/`MediaUrl` |
| Correlação | ID da mensagem retornado pelo provedor | Message SID |
| Retorno | Webhooks de mensagens/status | Webhook de entrada e StatusCallback |
| Verificação | GET challenge/verify token; POST HMAC-SHA256 dos bytes originais com App Secret | `X-Twilio-Signature`, URL externa exata e parâmetros completos; Auth Token da conta para validação |

Referências primárias: [coleção oficial Meta](https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api), [Messages Meta](https://www.postman.com/meta/whatsapp-business-platform/folder/o48mro7/messages), [requisições Twilio](https://www.twilio.com/docs/usage/requests-to-twilio), [Messages Twilio](https://www.twilio.com/docs/messaging/api/message-resource), [Content Templates](https://www.twilio.com/docs/content/send-templates-created-with-the-content-template-builder).

No lado Twilio, a chave de API para chamadas REST **não substitui** o Auth Token usado para autenticar callbacks. Não depender de uma lista fixa de parâmetros do webhook; o provedor pode acrescentá-los. A documentação recomenda o validador do SDK. [Autenticação e callbacks](https://www.twilio.com/docs/usage/rest-api-best-practices), [segurança e algoritmo](https://www.twilio.com/docs/usage/security).

Na Meta, verify token, App Secret e access token têm funções distintas. O verify token atende ao challenge; o App Secret autentica o corpo recebido; o access token autoriza chamadas REST. A comparação de assinatura deve ser constante no tempo, com limite de corpo antes do parse. A amostra oficial de [Graph webhooks](https://raw.githubusercontent.com/fbsamples/messenger-platform-samples/main/messenger-api/messenger-api-and-webhooks/app.py) evidencia essa separação. Seu handler é de Pages/Messenger, não um parser WhatsApp reutilizável.

A amostra em `fbsamples/whatsapp-api-examples/signature-validation-with-webhooks-payloads/app.py`, árvore `de70ee908a67026e642aaee3703d20464e2a9466`, mistura um TOKEN de exemplo, lógica de Pages e retorno 403 fora do bloco condicional. **Não copiar esse handler como implementação correta de WhatsApp.** Também não incorporar servidores Express/AWS das amostras como dependências do produto.

## Janela, aprovação e prospecção

O destinatário precisa ter opt-in para as mensagens pertinentes. Encontrar telefone no Maps/site não comprova opt-in. A janela de texto livre dura 24 horas após a última mensagem recebida do usuário; fora dela, usar template aprovado. Aplicar isso também aos follow-ups e respostas manuais. [Regras WhatsApp/Twilio](https://www.twilio.com/docs/whatsapp/api), [janela e templates](https://www.twilio.com/docs/whatsapp/key-concepts).

A [política primária do WhatsApp](https://whatsappbusiness.com/policy/), atualizada em 23/09/2026, também foi consultada: confirma opt-in, respeito a opt-out, templates aprovados para início de conversa e a janela de atendimento. Não se trata apenas de uma restrição da Twilio.

Decisão proposta: geração IA continua rascunho revisável. Publicar a cadência exige selecionar conteúdo habilitado para cada etapa/canal; texto gerado não passa a ser template aprovado automaticamente. Janela, aprovação atual, consentimento, resposta e opt-out são verificados novamente no despacho, não apenas na ativação. Não transformar o texto inteiro de uma mensagem em variável para contornar aprovação.

A documentação atual da Twilio contempla BSUID/`ExternalUserId`; nem toda entrada terá telefone. Guardar identificadores opacos no escopo da conta/portfolio, com número E.164 opcional e vínculo de lead anulável. Não unir clientes por um BSUID global nem criar empresa fictícia para acomodar uma conversa. O piloto de envio continua por telefone; disponibilidade de outbound BSUID varia por rollout. [Identificadores e rollout](https://www.twilio.com/docs/whatsapp/key-concepts).

## Onboarding: alternativas

1. **Credenciais próprias na interface — recomendação para 05A.** Empresa já tem ou prepara seus ativos no provedor, informa-os no app, valida a posse/acesso e configura callback gerado. Produto funciona por workspace, sem editar `.env` para cada cliente. Exige guia de configuração e permissões na conta do próprio cliente.
2. **Embedded Signup/Tech Provider.** Onboarding integrado ao login Meta, com requisitos de programa, verificação e revisão. Twilio documenta integração com Partner Solution e subcontas no fluxo ISV; isso não deve ser confundido com conectar a conta Twilio própria solicitada pelo usuário. [Programa Twilio](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program), [integração atual](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide).
3. **Chave global de WhatsApp no servidor.** Não atende à propriedade de conta e isolamento solicitados. Não será adotada como conexão de todos os clientes.

O estudo de [Embedded Signup publicado pela Meta](https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup) inclui revisão e permissões avançadas, mas também exemplos antigos de On-Premises/linha de crédito. Não transportar esses exemplos para o piloto BYO nem automatizar compartilhamento de cobrança.

## Preparação do piloto Meta

O assistente deverá orientar: localizar/criar aplicativo empresarial com produto WhatsApp; obter WABA e Phone Number ID no painel; disponibilizar número/recipiente de teste conforme o console; configurar permissões e token; cadastrar callback HTTPS e verify token do app; assinar os eventos da WABA; selecionar template de teste disponível. Não aceitar termos, registrar número real ou alterar conta Business automaticamente durante pesquisa.

Primeiro teste externo: conexão pelo formulário real, leitura de ativos, callback autenticado, envio confirmado exclusivamente a um destinatário de teste consentido, resposta na inbox e cancelamento das próximas etapas. A For Derm Clinic foi apenas um lead de pesquisa; não é destinatário autorizado desse piloto.

O endereço `127.0.0.1:3210` não recebe callbacks da Meta/Twilio pela internet. O aceite exige ingress HTTPS público válido, restrito às rotas de webhook, além do servidor/worker locais. Nenhuma exposição, túnel ou deploy foi criado nesta pesquisa. O hostname efetivo será necessário para validar a assinatura Twilio; não confiar em Host/X-Forwarded-* arbitrários enviados ao aplicativo.

## Limitações e evidência

- Portais `developers.facebook.com` responderam 429 ao leitor web. A coleção oficial Meta no Postman e amostras públicas Meta foram usadas como fontes primárias alternativas; alguns exemplos são antigos, identificados acima. Não houve acesso autenticado ao painel Meta.
- Sonda pública sem credencial em `graph.facebook.com/v25.0/0` e `/v26.0/0` retornou 400/code100 e headers `facebook-api-version` correspondentes. Isso não valida um ativo, permissão ou envio. Versão candidata do adaptador: **v26.0**, fixada no servidor e submetida ao aceite autenticado; não alegada como a mais recente nem usar fallback silencioso de versão.
- O navegador local informou `Local browser use is disabled in Work settings`. Não reconfiguramos navegador nem contornamos a restrição. A UX do concorrente usa as evidências já preservadas em `docs/reverse-engineering/FINDINGS.md` e `SURFACE-MAP.md`; não há nova observação autenticada. Twilio é exigência nova do usuário, não capacidade comprovada do CadenceFlow.
- Pesquisa sem benchmark de custo, capacidade ou entrega. Não houve novas chamadas Apify, JEV ou Codex de inferência. Não chamar adaptador implementado/testado por fixture de integração externa validada.

Desenho proposto: [marco 05A](../superpowers/specs/2026-10-21-prometeus-cadence-05a-whatsapp-design.md).
